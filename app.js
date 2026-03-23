const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const slugify = require("slugify");

const app = express();

// =========================
// CONFIG
// =========================
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const BASE_URL = (process.env.BASE_URL || "https://temanbelanja.store").replace(/\/+$/, "");
const SESSION_SECRET = process.env.SESSION_SECRET || "teman-belanja-secret";
const DEFAULT_PRODUCT_IMAGE = "https://via.placeholder.com/800x800?text=Teman+Belanja";

const PUBLIC_DIR = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");

// Railway volume preferred. Fallback local kalau /data tidak bisa dipakai.
let DATA_DIR = process.env.DATA_DIR || "/data";
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (error) {
  DATA_DIR = path.join(__dirname, "data");
}

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

// =========================
// INIT DIRECTORY & FILES
// =========================
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureFile(filePath, defaultValue = "[]") {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultValue, "utf8");
  }
}

ensureDir(PUBLIC_DIR);
ensureDir(VIEWS_DIR);
ensureDir(DATA_DIR);
ensureDir(UPLOAD_DIR);

ensureFile(PRODUCTS_FILE, "[]");
ensureFile(ARTICLES_FILE, "[]");
ensureFile(ORDERS_FILE, "[]");

// =========================
// APP SETUP
// =========================
app.set("view engine", "ejs");
app.set("views", VIEWS_DIR);
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "20mb" }));

app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    }
  })
);

// =========================
// FILE UPLOAD
// =========================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = ext || ".bin";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/jpg",
      "image/gif",
      "video/mp4",
      "video/webm",
      "video/ogg",
      "video/quicktime"
    ];

    if (allowed.includes(file.mimetype)) {
      return cb(null, true);
    }

    return cb(new Error("File harus berupa JPG, PNG, WEBP, GIF, MP4, WEBM, OGG, atau MOV"));
  }
});

// =========================
// HELPERS
// =========================
function readJson(file, fallback = []) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error(`Gagal membaca file JSON: ${file}`, error.message);
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.redirect("/admin/login");
}

function safeText(text = "") {
  return String(text || "").trim();
}

function boolFromForm(value) {
  return value === "on" || value === "true" || value === true;
}

function splitLinesToArray(value) {
  return String(value || "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeUrlArray(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((v) => safeText(v))
    .filter(Boolean);
}

function uniqueArray(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).filter(Boolean))];
}

function makeSlug(text) {
  return slugify(String(text || "").trim(), {
    lower: true,
    strict: true,
    locale: "id"
  });
}

function makeCategorySlug(category = "") {
  return String(category || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " dan ")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatCategoryNameFromSlug(slug = "") {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function uniqueSlug(baseSlug, existingItems, currentId = null) {
  const initial = baseSlug || `item-${Date.now()}`;
  let slug = initial;
  let counter = 1;

  while (
    existingItems.some(
      (item) => item.slug === slug && String(item.id) !== String(currentId || "")
    )
  ) {
    slug = `${initial}-${counter}`;
    counter++;
  }

  return slug;
}

function formatRupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function seoTitle(title) {
  return title
    ? `${title} | Teman Belanja`
    : "Teman Belanja - Rekomendasi Barang Bagus, Review, dan Tips Belanja";
}

function seoDescription(text, max = 160) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Teman Belanja membahas rekomendasi barang bagus, review jujur, tips memilih produk, dan artikel belanja yang membantu.";
  }
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const t = safeText(v);
    if (t) return t;
  }
  return "";
}

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteUrl(url = "") {
  const value = safeText(url);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function getProductMainImage(product = {}) {
  const candidates = [
    product.image,
    ...(Array.isArray(product.images) ? product.images : [])
  ]
    .map((item) => safeText(item))
    .filter(Boolean);

  const image = candidates[0] || DEFAULT_PRODUCT_IMAGE;
  return absoluteUrl(image);
}

function sortProductsForDisplay(items = []) {
  return [...items].sort((a, b) => {
    if (Number(b.isFeatured) !== Number(a.isFeatured)) {
      return Number(b.isFeatured) - Number(a.isFeatured);
    }

    const aUpdated = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bUpdated = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bUpdated - aUpdated;
  });
}

function getKnownCategories(products = []) {
  const staticCategories = [
    { slug: "cewek", name: "Cewek" },
    { slug: "cowok", name: "Cowok" },
    { slug: "rumah-tangga", name: "Rumah Tangga" },
    { slug: "elektronik", name: "Elektronik" }
  ];

  const dynamicCategories = uniqueArray(
    products
      .map((p) => safeText(p.categorySlug || makeCategorySlug(p.category)))
      .filter(Boolean)
  ).map((slug) => ({
    slug,
    name: formatCategoryNameFromSlug(slug)
  }));

  const merged = [...staticCategories];

  dynamicCategories.forEach((item) => {
    if (!merged.some((x) => x.slug === item.slug)) {
      merged.push(item);
    }
  });

  return merged;
}

function getRelatedProducts(products, currentProduct, limit = 4) {
  const currentCategorySlug = safeText(
    currentProduct.categorySlug || currentProduct.category_slug || makeCategorySlug(currentProduct.category)
  ).toLowerCase();

  const activeOthers = products.filter(
    (p) => p.active !== false && p.slug !== currentProduct.slug
  );

  const sameCategory = activeOthers.filter((p) => {
    const categorySlug = safeText(
      p.categorySlug || p.category_slug || makeCategorySlug(p.category)
    ).toLowerCase();

    return currentCategorySlug && categorySlug === currentCategorySlug;
  });

  const fallbackOthers = activeOthers.filter((p) => {
    return !sameCategory.some((item) => item.id === p.id);
  });

  return uniqueArray([
    ...sortProductsForDisplay(sameCategory),
    ...sortProductsForDisplay(fallbackOthers)
  ]).slice(0, limit);
}

function mergeImageSources({
  imageLinks = [],
  oldImages = [],
  uploadedImages = [],
  keepOldImages = false,
  limit = 7
}) {
  const merged = uniqueArray([
    ...imageLinks,
    ...(keepOldImages ? oldImages : []),
    ...uploadedImages
  ]).slice(0, limit);

  return merged.length ? merged : [DEFAULT_PRODUCT_IMAGE];
}

function mergeVideoSources({
  videoLinks = [],
  oldVideos = [],
  uploadedVideos = [],
  keepOldVideos = false,
  limit = 3
}) {
  return uniqueArray([
    ...videoLinks,
    ...(keepOldVideos ? oldVideos : []),
    ...uploadedVideos
  ]).slice(0, limit);
}

function getProducts() {
  const products = readJson(PRODUCTS_FILE, []);
  return products.map((item) => {
    const images = Array.isArray(item.images)
      ? normalizeUrlArray(item.images)
      : (item.image ? [safeText(item.image)] : []);

    const videos = Array.isArray(item.videos)
      ? normalizeUrlArray(item.videos)
      : [];

    const benefits = Array.isArray(item.benefits)
      ? item.benefits.map((x) => safeText(x)).filter(Boolean)
      : splitLinesToArray(item.benefits);

    const specs = Array.isArray(item.specs)
      ? item.specs.map((x) => safeText(x)).filter(Boolean)
      : splitLinesToArray(item.specs);

    const faq = Array.isArray(item.faq) ? item.faq : [];
    const category = safeText(item.category);
    const categorySlug = safeText(item.categorySlug || item.category_slug) || makeCategorySlug(category);

    return {
      ...item,
      name: safeText(item.name),
      slug: safeText(item.slug),
      price: Number(item.price || 0),
      category,
      categorySlug,
      suitableFor: safeText(item.suitableFor),
      desc: safeText(item.desc),
      shortDesc: safeText(item.shortDesc),
      image: safeText(item.image) || images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(item.affiliateUrl),
      sourceUrl: safeText(item.sourceUrl),
      metaTitle: safeText(item.metaTitle),
      metaDescription: safeText(item.metaDescription),
      focusKeyword: safeText(item.focusKeyword),
      benefits,
      specs,
      faq,
      isFeatured: !!item.isFeatured,
      active: item.active !== false,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
    };
  });
}

function saveProducts(data) {
  writeJson(PRODUCTS_FILE, data);
}

function getArticles() {
  const articles = readJson(ARTICLES_FILE, []);
  return articles.map((item) => ({
    ...item,
    title: safeText(item.title),
    slug: safeText(item.slug),
    cover: safeText(item.cover),
    excerpt: safeText(item.excerpt),
    content: safeText(item.content),
    keywords: safeText(item.keywords),
    metaTitle: safeText(item.metaTitle),
    metaDescription: safeText(item.metaDescription),
    active: item.active !== false,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
  }));
}

function saveArticles(data) {
  writeJson(ARTICLES_FILE, data);
}

function getOrders() {
  return readJson(ORDERS_FILE, []);
}

function saveOrders(data) {
  writeJson(ORDERS_FILE, data);
}

function productStructuredData(product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: firstNonEmpty(product.metaDescription, product.desc, product.shortDesc),
    image: product.images && product.images.length
      ? product.images.map((img) => absoluteUrl(img))
      : [absoluteUrl(product.image)].filter(Boolean),
    category: product.category || undefined,
    brand: {
      "@type": "Brand",
      name: "Teman Belanja"
    },
    offers: {
      "@type": "Offer",
      priceCurrency: "IDR",
      price: Number(product.price || 0),
      availability: "https://schema.org/InStock",
      url: `${BASE_URL}/produk/${product.slug}`
    }
  };
}

function articleStructuredData(article) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: firstNonEmpty(article.metaDescription, article.excerpt),
    image: article.cover ? [absoluteUrl(article.cover)] : undefined,
    author: {
      "@type": "Organization",
      name: "Teman Belanja"
    },
    publisher: {
      "@type": "Organization",
      name: "Teman Belanja"
    },
    datePublished: article.createdAt,
    dateModified: article.updatedAt || article.createdAt,
    mainEntityOfPage: `${BASE_URL}/artikel/${article.slug}`
  };
}

function breadcrumbStructuredData(items = []) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

function legalPageHtml({
  title,
  description,
  body
}) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} | Teman Belanja</title>
  <meta name="description" content="${safeDescription}" />
  <link rel="canonical" href="${BASE_URL}" />
  <style>
    body{
      margin:0;
      font-family:Arial,Helvetica,sans-serif;
      background:#f6f8fb;
      color:#1f2937;
      line-height:1.7;
    }
    .wrap{
      max-width:900px;
      margin:40px auto;
      background:#ffffff;
      border-radius:18px;
      box-shadow:0 10px 30px rgba(0,0,0,.06);
      padding:32px 24px;
    }
    h1{
      margin:0 0 12px;
      font-size:32px;
      line-height:1.2;
      color:#0f172a;
    }
    h2{
      margin-top:28px;
      font-size:22px;
      color:#111827;
    }
    p, li{
      font-size:16px;
      color:#374151;
    }
    ul{
      padding-left:20px;
    }
    a{
      color:#0f766e;
      text-decoration:none;
    }
    a:hover{
      text-decoration:underline;
    }
    .toplink{
      display:inline-block;
      margin-bottom:18px;
      font-weight:700;
    }
    .muted{
      color:#6b7280;
      font-size:14px;
      margin-top:10px;
    }
    @media (max-width: 640px){
      .wrap{
        margin:16px;
        padding:22px 16px;
      }
      h1{
        font-size:26px;
      }
      h2{
        font-size:20px;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <a class="toplink" href="${BASE_URL}">← Kembali ke Beranda</a>
    ${body}
    <p class="muted">Terakhir diperbarui: ${new Date().toLocaleDateString("id-ID")}</p>
  </main>
</body>
</html>`;
}

function createSeedProducts() {
  const current = getProducts();
  if (current.length > 0) return;

  const now = new Date().toISOString();
  const seed = [
    {
      id: crypto.randomUUID(),
      name: "Tas Wanita Elegan Premium",
      slug: "tas-wanita-elegan-premium",
      price: 129000,
      category: "Cewek",
      categorySlug: "cewek",
      suitableFor: "Wanita",
      shortDesc: "Tas wanita elegan untuk harian dan kerja.",
      desc: "Tas wanita elegan dengan desain modern, muat banyak, cocok dipakai harian, kuliah, kerja, dan jalan santai. Material terlihat rapi dan modelnya mudah dipadukan dengan outfit kasual maupun formal.",
      image: DEFAULT_PRODUCT_IMAGE,
      images: [DEFAULT_PRODUCT_IMAGE],
      videos: [],
      affiliateUrl: "https://shopee.co.id/",
      sourceUrl: "https://shopee.co.id/",
      metaTitle: "Tas Wanita Elegan Premium yang Cantik dan Nyaman Dipakai",
      metaDescription: "Review tas wanita elegan premium dengan desain cantik, ruang lega, dan cocok untuk aktivitas harian maupun kerja.",
      focusKeyword: "tas wanita elegan",
      benefits: ["Model elegan", "Cocok untuk harian", "Muatan cukup banyak"],
      specs: ["Kategori: Cewek", "Warna mengikuti varian toko", "Cocok untuk aktivitas harian"],
      faq: [],
      isFeatured: true,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: crypto.randomUUID(),
      name: "Rak Serbaguna Minimalis",
      slug: "rak-serbaguna-minimalis",
      price: 89000,
      category: "Rumah Tangga",
      categorySlug: "rumah-tangga",
      suitableFor: "Pria / Wanita",
      shortDesc: "Rak minimalis untuk menyimpan barang lebih rapi.",
      desc: "Rak serbaguna minimalis yang membantu ruangan terasa lebih rapi dan hemat tempat. Cocok dipakai di dapur, kamar mandi, area laundry, maupun ruang kerja kecil.",
      image: DEFAULT_PRODUCT_IMAGE,
      images: [DEFAULT_PRODUCT_IMAGE],
      videos: [],
      affiliateUrl: "https://shopee.co.id/",
      sourceUrl: "https://shopee.co.id/",
      metaTitle: "Rak Serbaguna Minimalis untuk Rumah Lebih Rapi",
      metaDescription: "Ulasan rak serbaguna minimalis yang praktis, hemat tempat, dan cocok untuk berbagai sudut rumah.",
      focusKeyword: "rak serbaguna minimalis",
      benefits: ["Hemat tempat", "Mudah dipakai", "Membantu rumah lebih rapi"],
      specs: ["Kategori: Rumah Tangga", "Model minimalis", "Cocok untuk banyak ruangan"],
      faq: [],
      isFeatured: false,
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];

  saveProducts(seed);
}

function createSeedArticles() {
  const current = getArticles();
  if (current.length > 0) return;

  const now = new Date().toISOString();
  const seed = [
    {
      id: crypto.randomUUID(),
      title: "10 Rekomendasi Barang Bagus untuk Rumah yang Layak Dicoba",
      slug: "10-rekomendasi-barang-bagus-untuk-rumah-yang-layak-dicoba",
      cover: "https://via.placeholder.com/1200x675?text=Artikel+Teman+Belanja",
      excerpt: "Daftar rekomendasi barang rumah tangga yang berguna, praktis, dan membantu rumah terasa lebih rapi.",
      content:
        "Mencari barang yang benar-benar berguna itu penting. Di artikel ini, Teman Belanja membahas beberapa rekomendasi barang rumah tangga yang fungsional, hemat, dan banyak dicari.\n\nPilih produk yang punya ulasan bagus, rating tinggi, dan deskripsi jelas. Jangan lupa bandingkan fitur sebelum memilih.",
      keywords: "rekomendasi barang bagus, barang rumah tangga, produk viral",
      metaTitle: "10 Rekomendasi Barang Bagus untuk Rumah yang Layak Dicoba",
      metaDescription: "Temukan rekomendasi barang bagus untuk rumah yang praktis, berguna, dan cocok untuk kebutuhan sehari-hari.",
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];

  saveArticles(seed);
}

createSeedProducts();
createSeedArticles();

// =========================
// APP LOCALS
// =========================
app.locals.BASE_URL = BASE_URL;
app.locals.formatRupiah = formatRupiah;

// =========================
// HEALTH CHECK
// =========================
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "teman-belanja",
    time: new Date().toISOString()
  });
});

// =========================
// FRONTEND ROUTES
// =========================
app.get("/", (req, res) => {
  const allProducts = getProducts().filter((p) => p.active !== false);
  const products = sortProductsForDisplay(allProducts).slice(0, 12);
  const categories = getKnownCategories(allProducts);

  const articles = getArticles()
    .filter((a) => a.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const structuredData = [
    breadcrumbStructuredData([{ name: "Beranda", url: `${BASE_URL}/` }])
  ];

  res.render("home", {
    pageTitle: seoTitle(),
    metaDescription:
      "Teman Belanja berisi rekomendasi barang bagus, review jujur, tips memilih produk, dan artikel belanja yang membantu.",
    canonical: `${BASE_URL}/`,
    path: req.originalUrl,
    products,
    articles,
    categories,
    structuredData
  });
});

app.get("/produk", (req, res) => {
  const q = safeText(req.query.q).toLowerCase();
  const kategoriParam = safeText(req.query.kategori);
  const kategoriSlug = safeText(req.query.kategoriSlug || makeCategorySlug(kategoriParam)).toLowerCase();

  let products = getProducts().filter((p) => p.active !== false);

  if (kategoriSlug) {
    products = products.filter((p) => safeText(p.categorySlug).toLowerCase() === kategoriSlug);
  }

  if (q) {
    products = products.filter((p) =>
      [
        p.name,
        p.category,
        p.categorySlug,
        p.suitableFor,
        p.focusKeyword,
        p.shortDesc,
        p.desc,
        ...(p.benefits || [])
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  products = sortProductsForDisplay(products);

  const categories = getKnownCategories(getProducts().filter((p) => p.active !== false));
  const currentCategoryName =
    categories.find((item) => item.slug === kategoriSlug)?.name || formatCategoryNameFromSlug(kategoriSlug);

  const breadcrumbItems = [
    { name: "Beranda", url: `${BASE_URL}/` },
    { name: "Produk", url: `${BASE_URL}/produk` }
  ];

  if (kategoriSlug) {
    breadcrumbItems.push({
      name: currentCategoryName || "Kategori",
      url: `${BASE_URL}/produk?kategoriSlug=${kategoriSlug}`
    });
  }

  const structuredData = [
    breadcrumbStructuredData(breadcrumbItems)
  ];

  res.render("products", {
    pageTitle: seoTitle(
      kategoriSlug
        ? `Produk ${currentCategoryName || "Kategori"}`
        : "Rekomendasi Barang Bagus"
    ),
    metaDescription: kategoriSlug
      ? `Kumpulan produk ${String(currentCategoryName || "kategori").toLowerCase()} terbaik di Teman Belanja lengkap dengan ulasan singkat dan tips memilih.`
      : "Kumpulan rekomendasi barang bagus di Teman Belanja lengkap dengan ulasan singkat, foto, dan panduan memilih.",
    canonical: kategoriSlug
      ? `${BASE_URL}/produk?kategoriSlug=${encodeURIComponent(kategoriSlug)}`
      : `${BASE_URL}/produk`,
    path: req.originalUrl,
    products,
    q,
    kategori: kategoriParam,
    kategoriSlug,
    currentCategoryName,
    categories,
    structuredData
  });
});

app.get("/kategori/:slug", (req, res) => {
  const slug = safeText(req.params.slug).toLowerCase();
  const allProducts = getProducts().filter((p) => p.active !== false);
  const categories = getKnownCategories(allProducts);

  const knownCategory = categories.find((item) => item.slug === slug);

  if (!knownCategory) {
    return res.status(404).render("404", {
      pageTitle: "Kategori Tidak Ditemukan",
      metaDescription: "Kategori tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`,
      path: req.originalUrl
    });
  }

  const categoryName = knownCategory.name;

  let products = allProducts.filter((p) => safeText(p.categorySlug).toLowerCase() === slug);
  products = sortProductsForDisplay(products);

  const structuredData = [
    breadcrumbStructuredData([
      { name: "Beranda", url: `${BASE_URL}/` },
      { name: categoryName, url: `${BASE_URL}/kategori/${slug}` }
    ])
  ];

  res.render("kategori", {
    pageTitle: seoTitle(`${categoryName} Terbaik`),
    metaDescription: `Temukan rekomendasi produk ${categoryName.toLowerCase()} terbaik di Teman Belanja lengkap dengan review singkat dan tips memilih.`,
    canonical: `${BASE_URL}/kategori/${slug}`,
    path: req.originalUrl,
    products,
    slug,
    categoryName,
    categories,
    structuredData
  });
});

app.get("/produk/:slug", (req, res) => {
  const products = getProducts();
  const product = products.find((p) => p.slug === req.params.slug && p.active !== false);

  if (!product) {
    return res.status(404).render("404", {
      pageTitle: "Produk Tidak Ditemukan",
      metaDescription: "Halaman tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`,
      path: req.originalUrl
    });
  }

  const related = getRelatedProducts(products, product, 4);

  const breadcrumbItems = [
    { name: "Beranda", url: `${BASE_URL}/` },
    { name: "Produk", url: `${BASE_URL}/produk` }
  ];

  if (product.categorySlug) {
    breadcrumbItems.push({
      name: product.category || "Kategori",
      url: `${BASE_URL}/kategori/${product.categorySlug}`
    });
  }

  breadcrumbItems.push({
    name: product.name,
    url: `${BASE_URL}/produk/${product.slug}`
  });

  const structuredData = [
    breadcrumbStructuredData(breadcrumbItems),
    productStructuredData(product)
  ];

  res.render("product-detail", {
    pageTitle: seoTitle(product.metaTitle || product.name),
    metaDescription: seoDescription(
      firstNonEmpty(product.metaDescription, product.shortDesc, product.desc, product.name)
    ),
    canonical: `${BASE_URL}/produk/${product.slug}`,
    path: req.originalUrl,
    product,
    related,
    structuredData
  });
});

app.get("/artikel", (req, res) => {
  const q = safeText(req.query.q).toLowerCase();
  let articles = getArticles().filter((a) => a.active !== false);

  if (q) {
    articles = articles.filter((a) =>
      [a.title, a.excerpt, a.content, a.keywords]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const structuredData = [
    breadcrumbStructuredData([
      { name: "Beranda", url: `${BASE_URL}/` },
      { name: "Artikel", url: `${BASE_URL}/artikel` }
    ])
  ];

  res.render("articles", {
    pageTitle: seoTitle("Artikel Rekomendasi & Tips Belanja"),
    metaDescription:
      "Artikel Teman Belanja membahas rekomendasi barang bagus, tips memilih produk, review, dan panduan belanja yang mudah dipahami.",
    canonical: `${BASE_URL}/artikel`,
    path: req.originalUrl,
    articles,
    q,
    structuredData
  });
});

app.get("/artikel/:slug", (req, res) => {
  const articles = getArticles();
  const article = articles.find((a) => a.slug === req.params.slug && a.active !== false);

  if (!article) {
    return res.status(404).render("404", {
      pageTitle: "Artikel Tidak Ditemukan",
      metaDescription: "Halaman tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`,
      path: req.originalUrl
    });
  }

  const related = articles
    .filter((a) => a.slug !== article.slug && a.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 4);

  const structuredData = [
    breadcrumbStructuredData([
      { name: "Beranda", url: `${BASE_URL}/` },
      { name: "Artikel", url: `${BASE_URL}/artikel` },
      { name: article.title, url: `${BASE_URL}/artikel/${article.slug}` }
    ]),
    articleStructuredData(article)
  ];

  res.render("article-detail", {
    pageTitle: seoTitle(article.metaTitle || article.title),
    metaDescription: seoDescription(article.metaDescription || article.excerpt || article.title),
    canonical: `${BASE_URL}/artikel/${article.slug}`,
    path: req.originalUrl,
    article,
    related,
    structuredData
  });
});

app.get("/go/:id", (req, res) => {
  const product = getProducts().find((p) => p.id === req.params.id && p.active !== false);

  if (!product) {
    return res.redirect("/produk");
  }

  const target = firstNonEmpty(product.affiliateUrl, product.sourceUrl);
  if (!target) {
    return res.redirect(`/produk/${product.slug}`);
  }

  return res.redirect(target);
});

// =========================
// LEGAL / TRUST PAGES
// =========================
app.get("/tentang-kami", (req, res) => {
  res.type("html").send(
    legalPageHtml({
      title: "Tentang Kami",
      description: "Tentang Teman Belanja, website rekomendasi produk, review, dan tips belanja online.",
      body: `
        <h1>Tentang Kami</h1>
        <p>Teman Belanja adalah website yang membahas rekomendasi produk, review singkat, dan tips belanja online agar pengunjung lebih mudah menemukan barang yang cocok sebelum membeli.</p>
        <p>Kami mengumpulkan berbagai referensi produk dari marketplace dan toko online terpercaya, lalu menampilkannya dalam bentuk halaman produk, artikel, dan rekomendasi yang mudah dipahami.</p>
        <h2>Fokus Kami</h2>
        <ul>
          <li>Rekomendasi produk yang sedang dicari banyak orang</li>
          <li>Ulasan singkat dan mudah dipahami</li>
          <li>Tips memilih produk sebelum membeli</li>
          <li>Konten belanja yang rapi, jelas, dan bermanfaat</li>
        </ul>
        <h2>Model Layanan</h2>
        <p>Teman Belanja dapat memperoleh komisi affiliate dari beberapa tautan produk yang tersedia di website. Harga produk bagi pembeli tetap mengikuti harga dari marketplace atau toko asal.</p>
      `
    })
  );
});

app.get("/kontak", (req, res) => {
  res.type("html").send(
    legalPageHtml({
      title: "Kontak",
      description: "Halaman kontak Teman Belanja untuk pertanyaan, kerja sama, dan informasi umum.",
      body: `
        <h1>Kontak</h1>
        <p>Jika Anda memiliki pertanyaan, masukan, atau ingin bekerja sama, silakan hubungi Teman Belanja melalui informasi berikut.</p>
        <h2>Informasi Kontak</h2>
        <p>Email: <a href="mailto:admin@temanbelanja.store">admin@temanbelanja.store</a></p>
        <p>Website: <a href="${BASE_URL}">${BASE_URL}</a></p>
        <h2>Keperluan yang Bisa Dihubungi</h2>
        <ul>
          <li>Pertanyaan seputar konten website</li>
          <li>Laporan tautan produk yang tidak aktif</li>
          <li>Kerja sama promosi atau kolaborasi</li>
          <li>Masukan untuk pengembangan Teman Belanja</li>
        </ul>
        <p>Untuk pertanyaan terkait pesanan, pembayaran, pengiriman, atau pengembalian barang, silakan hubungi marketplace atau toko tempat produk dibeli.</p>
      `
    })
  );
});

app.get("/kebijakan-privasi", (req, res) => {
  res.type("html").send(
    legalPageHtml({
      title: "Kebijakan Privasi",
      description: "Kebijakan privasi Teman Belanja mengenai penggunaan data pengunjung website.",
      body: `
        <h1>Kebijakan Privasi</h1>
        <p>Teman Belanja menghargai privasi setiap pengunjung website. Halaman ini menjelaskan secara ringkas bagaimana informasi pengunjung digunakan.</p>
        <h2>Informasi yang Dikumpulkan</h2>
        <p>Kami dapat mengumpulkan informasi non-pribadi seperti halaman yang dikunjungi, perangkat yang digunakan, serta data analitik untuk membantu meningkatkan performa website.</p>
        <h2>Penggunaan Data</h2>
        <ul>
          <li>Meningkatkan kualitas konten dan pengalaman pengguna</li>
          <li>Menganalisis performa halaman dan produk</li>
          <li>Menjaga keamanan website</li>
        </ul>
        <h2>Cookie</h2>
        <p>Website ini dapat menggunakan cookie atau teknologi serupa untuk analitik, performa, dan pengalaman pengguna yang lebih baik.</p>
        <h2>Tautan Pihak Ketiga</h2>
        <p>Teman Belanja dapat menampilkan tautan ke marketplace atau website pihak ketiga. Kebijakan privasi pada website pihak ketiga mengikuti aturan masing-masing penyedia layanan tersebut.</p>
        <h2>Persetujuan</h2>
        <p>Dengan menggunakan website ini, Anda dianggap memahami dan menyetujui kebijakan privasi ini.</p>
      `
    })
  );
});

app.get("/kebijakan-pengembalian", (req, res) => {
  res.type("html").send(
    legalPageHtml({
      title: "Kebijakan Pengembalian",
      description: "Kebijakan pengembalian produk Teman Belanja untuk keperluan verifikasi Merchant Center.",
      body: `
        <h1>Kebijakan Pengembalian</h1>
        <p>Teman Belanja adalah website rekomendasi produk dan affiliate. Sebagian besar transaksi pembelian dilakukan melalui marketplace atau toko pihak ketiga yang ditautkan dari halaman produk.</p>
        <h2>Ketentuan Pengembalian</h2>
        <p>Pengembalian, penukaran barang, pengajuan komplain, serta proses refund mengikuti kebijakan resmi dari marketplace atau toko tempat pembelian dilakukan.</p>
        <h2>Barang Rusak atau Tidak Sesuai</h2>
        <p>Jika barang yang diterima rusak, cacat, tidak lengkap, atau tidak sesuai deskripsi, pembeli dapat mengajukan komplain dan pengembalian melalui platform tempat transaksi dilakukan sesuai syarat yang berlaku di sana.</p>
        <h2>Biaya Pengembalian</h2>
        <p>Biaya pengembalian, jika ada, mengikuti kebijakan masing-masing marketplace, penjual, atau jasa pengiriman yang digunakan.</p>
        <h2>Bantuan</h2>
        <p>Jika Anda menemukan tautan produk yang bermasalah di Teman Belanja, silakan hubungi kami melalui halaman kontak agar dapat kami tinjau.</p>
      `
    })
  );
});

app.get("/syarat-dan-ketentuan", (req, res) => {
  res.type("html").send(
    legalPageHtml({
      title: "Syarat dan Ketentuan",
      description: "Syarat dan ketentuan penggunaan website Teman Belanja.",
      body: `
        <h1>Syarat dan Ketentuan</h1>
        <p>Dengan mengakses dan menggunakan website Teman Belanja, Anda dianggap telah memahami dan menyetujui syarat dan ketentuan berikut.</p>
        <h2>Informasi Produk</h2>
        <p>Teman Belanja menampilkan rekomendasi, referensi, dan informasi produk. Kami berusaha menjaga informasi tetap akurat, namun detail harga, stok, varian, dan ketersediaan dapat berubah sewaktu-waktu mengikuti marketplace atau penjual asal.</p>
        <h2>Tautan Affiliate</h2>
        <p>Beberapa tautan pada website ini dapat berupa tautan affiliate. Teman Belanja bisa memperoleh komisi dari pembelian yang dilakukan melalui tautan tersebut tanpa menambah harga bagi pembeli.</p>
        <h2>Tanggung Jawab Transaksi</h2>
        <p>Transaksi pembelian, pembayaran, pengiriman, komplain, dan pengembalian dilakukan di platform pihak ketiga. Karena itu, ketentuan transaksi mengikuti aturan marketplace atau toko tempat pembelian dilakukan.</p>
        <h2>Penggunaan Konten</h2>
        <p>Pengunjung tidak diperbolehkan menyalin seluruh isi website untuk tujuan komersial tanpa izin tertulis.</p>
        <h2>Perubahan Ketentuan</h2>
        <p>Teman Belanja dapat memperbarui syarat dan ketentuan ini sewaktu-waktu untuk menyesuaikan layanan dan kebijakan website.</p>
      `
    })
  );
});

// =========================
// SEO ROUTES
// =========================
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /
Sitemap: ${BASE_URL}/sitemap.xml`);
});

app.get("/sitemap.xml", (req, res) => {
  const products = getProducts().filter((p) => p.active !== false);
  const articles = getArticles().filter((a) => a.active !== false);
  const categories = getKnownCategories(products);

  const urls = [
    { loc: `${BASE_URL}/`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/produk`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/artikel`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/tentang-kami`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/kontak`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/kebijakan-privasi`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/kebijakan-pengembalian`, lastmod: new Date().toISOString() },
    { loc: `${BASE_URL}/syarat-dan-ketentuan`, lastmod: new Date().toISOString() },
    ...categories.map((category) => ({
      loc: `${BASE_URL}/kategori/${category.slug}`,
      lastmod: new Date().toISOString()
    })),
    ...products.map((p) => ({
      loc: `${BASE_URL}/produk/${p.slug}`,
      lastmod: p.updatedAt || p.createdAt || new Date().toISOString()
    })),
    ...articles.map((a) => ({
      loc: `${BASE_URL}/artikel/${a.slug}`,
      lastmod: a.updatedAt || a.createdAt || new Date().toISOString()
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((item) => {
    return `  <url><loc>${escapeXml(item.loc)}</loc><lastmod>${escapeXml(item.lastmod)}</lastmod></url>`;
  })
  .join("\n")}
</urlset>`;

  res.type("application/xml");
  res.send(xml);
});

app.get("/feed.xml", (req, res) => {
  const products = getProducts()
    .filter((p) => p.active !== false)
    .filter((p) => safeText(p.name) && Number(p.price || 0) > 0);

  const items = products
    .map((p) => {
      const productLink = `${BASE_URL}/produk/${p.slug}`;
      const imageLink = getProductMainImage(p);
      const description = firstNonEmpty(
        p.metaDescription,
        p.shortDesc,
        p.desc,
        p.name
      );
      const category = firstNonEmpty(p.category, formatCategoryNameFromSlug(p.categorySlug), "Produk");
      const availability = "in stock";
      const condition = "new";

      return `    <item>
      <g:id>${escapeXml(String(p.id || p.slug))}</g:id>
      <title>${escapeXml(p.name)}</title>
      <description>${escapeXml(description)}</description>
      <link>${escapeXml(productLink)}</link>
      <g:link>${escapeXml(productLink)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${Number(p.price || 0)} IDR</g:price>
      <g:condition>${condition}</g:condition>
      <g:brand>${escapeXml("Teman Belanja")}</g:brand>
      <g:product_type>${escapeXml(category)}</g:product_type>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Teman Belanja</title>
    <link>${escapeXml(BASE_URL)}</link>
    <description>Feed produk Teman Belanja untuk Google Merchant Center</description>
${items}
  </channel>
</rss>`;

  res.type("application/xml; charset=utf-8");
  res.send(xml);
});

// =========================
// ADMIN AUTH
// =========================
app.get("/admin/login", (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect("/admin");
  }

  res.render("admin-login", {
    pageTitle: "Login Admin",
    metaDescription: "Login admin Teman Belanja",
    canonical: `${BASE_URL}/admin/login`,
    path: req.originalUrl
  });
});

app.post("/admin/login", (req, res) => {
  const id = safeText(req.body.id);
  const password = safeText(req.body.password);

  if (id === ADMIN_ID && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    req.session.adminId = ADMIN_ID;
    return res.redirect("/admin");
  }

  return res.status(401).send("ID atau password salah");
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

// =========================
// ADMIN DASHBOARD
// =========================
app.get("/admin", requireAdmin, (req, res) => {
  res.render("admin-dashboard", {
    pageTitle: "Dashboard Admin",
    metaDescription: "Dashboard admin Teman Belanja",
    canonical: `${BASE_URL}/admin`,
    path: req.originalUrl,
    totalProducts: getProducts().length,
    totalArticles: getArticles().length,
    totalOrders: getOrders().length
  });
});

// =========================
// ADMIN PRODUCTS
// =========================
app.get("/admin/products", requireAdmin, (req, res) => {
  const products = getProducts().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.render("admin-products", {
    pageTitle: "Admin Produk",
    metaDescription: "Kelola rekomendasi produk",
    canonical: `${BASE_URL}/admin/products`,
    path: req.originalUrl,
    products
  });
});

app.get("/admin/products/new", requireAdmin, (req, res) => {
  res.render("admin-product-form", {
    pageTitle: "Tambah Produk",
    metaDescription: "Tambah rekomendasi produk",
    canonical: `${BASE_URL}/admin/products/new`,
    path: req.originalUrl,
    product: null
  });
});

app.post(
  "/admin/products/new",
  requireAdmin,
  upload.fields([
    { name: "imageFiles", maxCount: 7 },
    { name: "videoFiles", maxCount: 3 }
  ]),
  (req, res) => {
    const products = getProducts();

    const name = safeText(req.body.name);
    if (!name) {
      return res.status(400).send("Nama produk wajib diisi");
    }

    const uploadedImages = (req.files?.imageFiles || []).map((file) => `/uploads/${file.filename}`);
    const uploadedVideos = (req.files?.videoFiles || []).map((file) => `/uploads/${file.filename}`);

    const imageLinks = splitLinesToArray(req.body.imageLinks).slice(0, 7);
    const videoLinks = splitLinesToArray(req.body.videoLinks).slice(0, 3);

    const images = mergeImageSources({
      imageLinks,
      uploadedImages,
      keepOldImages: false,
      limit: 7
    });

    const videos = mergeVideoSources({
      videoLinks,
      uploadedVideos,
      keepOldVideos: false,
      limit: 3
    });

    const baseSlug = makeSlug(name);
    const slug = uniqueSlug(baseSlug, products);
    const now = new Date().toISOString();

    const category = safeText(req.body.category);
    const categorySlug = makeCategorySlug(category);

    const item = {
      id: crypto.randomUUID(),
      name,
      slug,
      price: Number(req.body.price || 0),
      category,
      categorySlug,
      suitableFor: safeText(req.body.suitableFor),
      shortDesc: safeText(req.body.shortDesc),
      desc: safeText(req.body.desc),
      image: images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(req.body.affiliateUrl),
      sourceUrl: safeText(req.body.sourceUrl),
      metaTitle: safeText(req.body.metaTitle),
      metaDescription: safeText(req.body.metaDescription),
      focusKeyword: safeText(req.body.focusKeyword),
      benefits: splitLinesToArray(req.body.benefits),
      specs: splitLinesToArray(req.body.specs),
      faq: [],
      isFeatured: boolFromForm(req.body.isFeatured),
      active: req.body.active === undefined ? true : boolFromForm(req.body.active),
      createdAt: now,
      updatedAt: now
    };

    products.unshift(item);
    saveProducts(products);
    res.redirect("/admin/products");
  }
);

app.get("/admin/products/edit/:id", requireAdmin, (req, res) => {
  const product = getProducts().find((p) => p.id === req.params.id);

  if (!product) {
    return res.status(404).send("Produk tidak ditemukan");
  }

  res.render("admin-product-form", {
    pageTitle: "Edit Produk",
    metaDescription: "Edit rekomendasi produk",
    canonical: `${BASE_URL}/admin/products/edit/${product.id}`,
    path: req.originalUrl,
    product
  });
});

app.post(
  "/admin/products/edit/:id",
  requireAdmin,
  upload.fields([
    { name: "imageFiles", maxCount: 7 },
    { name: "videoFiles", maxCount: 3 }
  ]),
  (req, res) => {
    const products = getProducts();
    const index = products.findIndex((p) => p.id === req.params.id);

    if (index === -1) {
      return res.status(404).send("Produk tidak ditemukan");
    }

    const old = products[index];
    const name = safeText(req.body.name);

    if (!name) {
      return res.status(400).send("Nama produk wajib diisi");
    }

    const uploadedImages = (req.files?.imageFiles || []).map((file) => `/uploads/${file.filename}`);
    const uploadedVideos = (req.files?.videoFiles || []).map((file) => `/uploads/${file.filename}`);

    const imageLinks = splitLinesToArray(req.body.imageLinks).slice(0, 7);
    const videoLinks = splitLinesToArray(req.body.videoLinks).slice(0, 3);

    const keepOldImages = req.body.keepOldImages === undefined ? true : boolFromForm(req.body.keepOldImages);
    const keepOldVideos = req.body.keepOldVideos === undefined ? true : boolFromForm(req.body.keepOldVideos);

    const oldImages = Array.isArray(old.images)
      ? old.images
      : (old.image ? [old.image] : []);

    const oldVideos = Array.isArray(old.videos) ? old.videos : [];

    const images = mergeImageSources({
      imageLinks,
      oldImages,
      uploadedImages,
      keepOldImages,
      limit: 7
    });

    const videos = mergeVideoSources({
      videoLinks,
      oldVideos,
      uploadedVideos,
      keepOldVideos,
      limit: 3
    });

    const baseSlug = makeSlug(name);
    const slug = uniqueSlug(baseSlug, products, old.id);
    const now = new Date().toISOString();

    const category = safeText(req.body.category);
    const categorySlug = makeCategorySlug(category);

    products[index] = {
      ...old,
      name,
      slug,
      price: Number(req.body.price || 0),
      category,
      categorySlug,
      suitableFor: safeText(req.body.suitableFor),
      shortDesc: safeText(req.body.shortDesc),
      desc: safeText(req.body.desc),
      image: images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(req.body.affiliateUrl),
      sourceUrl: safeText(req.body.sourceUrl),
      metaTitle: safeText(req.body.metaTitle),
      metaDescription: safeText(req.body.metaDescription),
      focusKeyword: safeText(req.body.focusKeyword),
      benefits: splitLinesToArray(req.body.benefits),
      specs: splitLinesToArray(req.body.specs),
      faq: Array.isArray(old.faq) ? old.faq : [],
      isFeatured: boolFromForm(req.body.isFeatured),
      active: req.body.active === undefined ? old.active !== false : boolFromForm(req.body.active),
      updatedAt: now
    };

    saveProducts(products);
    res.redirect("/admin/products");
  }
);

app.get("/admin/products/delete/:id", requireAdmin, (req, res) => {
  const products = getProducts();
  const filtered = products.filter((p) => p.id !== req.params.id);
  saveProducts(filtered);
  res.redirect("/admin/products");
});

// =========================
// ADMIN ARTICLES
// =========================
app.get("/admin/articles", requireAdmin, (req, res) => {
  const articles = getArticles().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.render("admin-articles", {
    pageTitle: "Admin Artikel",
    metaDescription: "Kelola artikel SEO",
    canonical: `${BASE_URL}/admin/articles`,
    path: req.originalUrl,
    articles
  });
});

app.get("/admin/articles/new", requireAdmin, (req, res) => {
  res.render("admin-article-form", {
    pageTitle: "Tambah Artikel",
    metaDescription: "Tambah artikel SEO",
    canonical: `${BASE_URL}/admin/articles/new`,
    path: req.originalUrl,
    article: null
  });
});

app.post("/admin/articles/new", requireAdmin, upload.single("coverFile"), (req, res) => {
  const articles = getArticles();
  const title = safeText(req.body.title);

  if (!title) {
    return res.status(400).send("Judul artikel wajib diisi");
  }

  const cover = req.file ? `/uploads/${req.file.filename}` : safeText(req.body.cover);
  const baseSlug = makeSlug(title);
  const slug = uniqueSlug(baseSlug, articles);
  const now = new Date().toISOString();

  const item = {
    id: crypto.randomUUID(),
    title,
    slug,
    cover,
    excerpt: safeText(req.body.excerpt),
    content: safeText(req.body.content),
    keywords: safeText(req.body.keywords),
    metaTitle: safeText(req.body.metaTitle),
    metaDescription: safeText(req.body.metaDescription),
    active: req.body.active === undefined ? true : boolFromForm(req.body.active),
    createdAt: now,
    updatedAt: now
  };

  articles.unshift(item);
  saveArticles(articles);
  res.redirect("/admin/articles");
});

app.get("/admin/articles/edit/:id", requireAdmin, (req, res) => {
  const article = getArticles().find((a) => a.id === req.params.id);

  if (!article) {
    return res.status(404).send("Artikel tidak ditemukan");
  }

  res.render("admin-article-form", {
    pageTitle: "Edit Artikel",
    metaDescription: "Edit artikel SEO",
    canonical: `${BASE_URL}/admin/articles/edit/${article.id}`,
    path: req.originalUrl,
    article
  });
});

app.post("/admin/articles/edit/:id", requireAdmin, upload.single("coverFile"), (req, res) => {
  const articles = getArticles();
  const index = articles.findIndex((a) => a.id === req.params.id);

  if (index === -1) {
    return res.status(404).send("Artikel tidak ditemukan");
  }

  const old = articles[index];
  const title = safeText(req.body.title);

  if (!title) {
    return res.status(400).send("Judul artikel wajib diisi");
  }

  const cover = req.file ? `/uploads/${req.file.filename}` : safeText(req.body.cover) || old.cover;
  const baseSlug = makeSlug(title);
  const slug = uniqueSlug(baseSlug, articles, old.id);

  articles[index] = {
    ...old,
    title,
    slug,
    cover,
    excerpt: safeText(req.body.excerpt),
    content: safeText(req.body.content),
    keywords: safeText(req.body.keywords),
    metaTitle: safeText(req.body.metaTitle),
    metaDescription: safeText(req.body.metaDescription),
    active: req.body.active === undefined ? old.active !== false : boolFromForm(req.body.active),
    updatedAt: new Date().toISOString()
  };

  saveArticles(articles);
  res.redirect("/admin/articles");
});

app.get("/admin/articles/delete/:id", requireAdmin, (req, res) => {
  const articles = getArticles();
  const filtered = articles.filter((a) => a.id !== req.params.id);
  saveArticles(filtered);
  res.redirect("/admin/articles");
});

// =========================
// OPTIONAL ORDERS VIEW
// =========================
app.get("/admin/orders", requireAdmin, (req, res) => {
  const orders = getOrders().sort((a, b) => {
    const at = new Date(a.createdAt || 0).getTime();
    const bt = new Date(b.createdAt || 0).getTime();
    return bt - at;
  });

  res.json({ ok: true, orders });
});

// =========================
// 404
// =========================
app.use((req, res) => {
  if (fs.existsSync(path.join(VIEWS_DIR, "404.ejs"))) {
    return res.status(404).render("404", {
      pageTitle: "Halaman Tidak Ditemukan",
      metaDescription: "Halaman tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`,
      path: req.originalUrl
    });
  }

  return res.status(404).send("Halaman tidak ditemukan");
});

// =========================
// ERROR HANDLER
// =========================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  if (err instanceof multer.MulterError) {
    return res.status(400).send(`Upload gagal: ${err.message}`);
  }

  if (err && err.message) {
    return res.status(400).send(err.message);
  }

  return res.status(500).send("Terjadi kesalahan pada server");
});

// =========================
// START
// =========================
app.listen(PORT, () => {
  console.log(`Teman Belanja running on port ${PORT}`);
  console.log(`Admin login ID: ${ADMIN_ID}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Upload dir: ${UPLOAD_DIR}`);
});
