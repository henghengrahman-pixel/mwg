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
const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const BASE_URL = process.env.BASE_URL || "https://temanbelanja.com";
const SESSION_SECRET = process.env.SESSION_SECRET || "teman-belanja-secret";

// penting untuk Railway volume
const DATA_DIR = process.env.DATA_DIR || "/data";

const PUBLIC_DIR = path.join(__dirname, "public");
const VIEWS_DIR = path.join(__dirname, "views");

// upload disimpan ke volume, bukan ke folder project
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

ensureDir(DATA_DIR);
ensureDir(PUBLIC_DIR);
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

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "20mb" }));

// static normal
app.use(express.static(PUBLIC_DIR));

// static upload dari volume
app.use("/uploads", express.static(UPLOAD_DIR));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
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

function makeSlug(text) {
  return slugify(String(text || "").trim(), {
    lower: true,
    strict: true,
    locale: "id"
  });
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
    : "Teman Belanja - Rekomendasi Belanja, Review, Promo & Affiliate";
}

function seoDescription(text, max = 160) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Teman Belanja berisi rekomendasi produk, artikel SEO, review, promo, dan link affiliate pilihan.";
  }
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
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

function getProducts() {
  const products = readJson(PRODUCTS_FILE, []);
  return products.map((item) => {
    const images = Array.isArray(item.images)
      ? normalizeUrlArray(item.images)
      : (item.image ? [safeText(item.image)] : []);

    const videos = Array.isArray(item.videos)
      ? normalizeUrlArray(item.videos)
      : [];

    return {
      ...item,
      name: safeText(item.name),
      slug: safeText(item.slug),
      price: Number(item.price || 0),
      category: safeText(item.category),
      desc: safeText(item.desc),
      image: safeText(item.image) || images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(item.affiliateUrl),
      metaTitle: safeText(item.metaTitle),
      metaDescription: safeText(item.metaDescription),
      isFeatured: !!item.isFeatured,
      active: item.active !== false,
      createdAt: item.createdAt || new Date().toISOString()
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
    createdAt: item.createdAt || new Date().toISOString()
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

function createSeedProducts() {
  const current = getProducts();
  if (current.length > 0) return;

  const seed = [
    {
      id: crypto.randomUUID(),
      name: "Tas Wanita Elegan Premium",
      slug: "tas-wanita-elegan-premium",
      price: 129000,
      category: "Fashion",
      desc: "Tas wanita model elegan yang cocok untuk harian, kerja, dan hangout.",
      image: "https://via.placeholder.com/800x800?text=Teman+Belanja",
      images: ["https://via.placeholder.com/800x800?text=Teman+Belanja"],
      videos: [],
      affiliateUrl: "https://shopee.co.id/",
      metaTitle: "Tas Wanita Elegan Premium Murah dan Bagus",
      metaDescription: "Rekomendasi tas wanita elegan premium dengan desain kekinian dan harga terjangkau.",
      isFeatured: true,
      active: true,
      createdAt: new Date().toISOString()
    },
    {
      id: crypto.randomUUID(),
      name: "Rak Serbaguna Minimalis",
      slug: "rak-serbaguna-minimalis",
      price: 89000,
      category: "Rumah Tangga",
      desc: "Rak serbaguna minimalis untuk dapur, kamar mandi, atau ruang kerja.",
      image: "https://via.placeholder.com/800x800?text=Teman+Belanja",
      images: ["https://via.placeholder.com/800x800?text=Teman+Belanja"],
      videos: [],
      affiliateUrl: "https://shopee.co.id/",
      metaTitle: "Rak Serbaguna Minimalis Murah",
      metaDescription: "Rak serbaguna minimalis yang praktis, hemat tempat, dan cocok untuk berbagai ruangan.",
      isFeatured: false,
      active: true,
      createdAt: new Date().toISOString()
    }
  ];

  saveProducts(seed);
}

function createSeedArticles() {
  const current = getArticles();
  if (current.length > 0) return;

  const seed = [
    {
      id: crypto.randomUUID(),
      title: "10 Rekomendasi Produk Shopee yang Berguna untuk Rumah",
      slug: "10-rekomendasi-produk-shopee-yang-berguna-untuk-rumah",
      cover: "https://via.placeholder.com/1200x675?text=Artikel+Teman+Belanja",
      excerpt: "Daftar rekomendasi produk yang berguna, murah, dan cocok dibeli untuk kebutuhan rumah tangga.",
      content:
        "Mencari produk yang benar-benar berguna itu penting. Di artikel ini, Teman Belanja membahas beberapa rekomendasi produk rumah tangga yang fungsional, hemat, dan banyak dicari.\n\nPilih produk yang punya ulasan bagus, rating tinggi, dan deskripsi jelas. Jangan lupa bandingkan harga sebelum membeli.",
      keywords: "rekomendasi produk shopee, barang rumah tangga, produk viral",
      metaTitle: "10 Rekomendasi Produk Shopee yang Berguna untuk Rumah",
      metaDescription: "Temukan rekomendasi produk Shopee yang berguna untuk rumah, murah, praktis, dan layak dibeli.",
      active: true,
      createdAt: new Date().toISOString()
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
// FRONTEND ROUTES
// =========================
app.get("/", (req, res) => {
  const products = getProducts()
    .filter((p) => p.active !== false)
    .sort((a, b) => {
      if (Number(b.isFeatured) !== Number(a.isFeatured)) {
        return Number(b.isFeatured) - Number(a.isFeatured);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, 12);

  const articles = getArticles()
    .filter((a) => a.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  res.render("home", {
    pageTitle: seoTitle(),
    metaDescription:
      "Teman Belanja berisi rekomendasi produk, artikel tips belanja, promo, review, dan link affiliate pilihan.",
    canonical: `${BASE_URL}/`,
    products,
    articles
  });
});

app.get("/produk", (req, res) => {
  const q = safeText(req.query.q).toLowerCase();
  let products = getProducts().filter((p) => p.active !== false);

  if (q) {
    products = products.filter((p) =>
      [p.name, p.category]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  products.sort((a, b) => {
    if (Number(b.isFeatured) !== Number(a.isFeatured)) {
      return Number(b.isFeatured) - Number(a.isFeatured);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  res.render("products", {
    pageTitle: seoTitle("Produk Pilihan"),
    metaDescription:
      "Kumpulan produk pilihan di Teman Belanja lengkap dengan link affiliate dan rekomendasi terbaik.",
    canonical: `${BASE_URL}/produk`,
    products,
    q
  });
});

app.get("/produk/:slug", (req, res) => {
  const products = getProducts();
  const product = products.find(
    (p) => p.slug === req.params.slug && p.active !== false
  );

  if (!product) {
    return res.status(404).render("404", {
      pageTitle: "Produk Tidak Ditemukan",
      metaDescription: "Halaman tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`
    });
  }

  const related = products
    .filter((p) => p.slug !== product.slug && p.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 4);

  res.render("product-detail", {
    pageTitle: seoTitle(product.metaTitle || product.name),
    metaDescription: seoDescription(product.metaDescription || product.desc || product.name),
    canonical: `${BASE_URL}/produk/${product.slug}`,
    product,
    related
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

  res.render("articles", {
    pageTitle: seoTitle("Artikel Belanja & SEO"),
    metaDescription:
      "Artikel Teman Belanja membahas tips belanja, review produk, rekomendasi barang, dan konten SEO yang mudah ditemukan di Google.",
    canonical: `${BASE_URL}/artikel`,
    articles,
    q
  });
});

app.get("/artikel/:slug", (req, res) => {
  const articles = getArticles();
  const article = articles.find(
    (a) => a.slug === req.params.slug && a.active !== false
  );

  if (!article) {
    return res.status(404).render("404", {
      pageTitle: "Artikel Tidak Ditemukan",
      metaDescription: "Halaman tidak ditemukan",
      canonical: `${BASE_URL}${req.originalUrl}`
    });
  }

  const related = articles
    .filter((a) => a.slug !== article.slug && a.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 4);

  res.render("article-detail", {
    pageTitle: seoTitle(article.metaTitle || article.title),
    metaDescription: seoDescription(article.metaDescription || article.excerpt || article.title),
    canonical: `${BASE_URL}/artikel/${article.slug}`,
    article,
    related
  });
});

// redirect affiliate
app.get("/go/:id", (req, res) => {
  const product = getProducts().find((p) => p.id === req.params.id && p.active !== false);

  if (!product || !product.affiliateUrl) {
    return res.redirect("/produk");
  }

  return res.redirect(product.affiliateUrl);
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

  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/produk`,
    `${BASE_URL}/artikel`,
    ...products.map((p) => `${BASE_URL}/produk/${p.slug}`),
    ...articles.map((a) => `${BASE_URL}/artikel/${a.slug}`)
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => `  <url><loc>${url}</loc></url>`)
  .join("\n")}
</urlset>`;

  res.type("application/xml");
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
    canonical: `${BASE_URL}/admin/login`
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
    metaDescription: "Kelola produk affiliate",
    canonical: `${BASE_URL}/admin/products`,
    products
  });
});

app.get("/admin/products/new", requireAdmin, (req, res) => {
  res.render("admin-product-form", {
    pageTitle: "Tambah Produk",
    metaDescription: "Tambah produk affiliate",
    canonical: `${BASE_URL}/admin/products/new`,
    product: null
  });
});

app.post(
  "/admin/products/new",
  requireAdmin,
  upload.fields([
    { name: "imageFiles", maxCount: 10 },
    { name: "videoFiles", maxCount: 5 }
  ]),
  (req, res) => {
    const products = getProducts();

    const name = safeText(req.body.name);
    if (!name) {
      return res.status(400).send("Nama produk wajib diisi");
    }

    const uploadedImages = (req.files?.imageFiles || []).map((file) => `/uploads/${file.filename}`);
    const uploadedVideos = (req.files?.videoFiles || []).map((file) => `/uploads/${file.filename}`);

    const imageLinks = splitLinesToArray(req.body.imageLinks);
    const videoLinks = splitLinesToArray(req.body.videoLinks);

    const images = [...uploadedImages, ...imageLinks];
    const videos = [...uploadedVideos, ...videoLinks];

    const baseSlug = makeSlug(name);
    const slug = uniqueSlug(baseSlug, products);

    const item = {
      id: crypto.randomUUID(),
      name,
      slug,
      price: Number(req.body.price || 0),
      category: safeText(req.body.category),
      desc: safeText(req.body.desc),
      image: images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(req.body.affiliateUrl),
      metaTitle: safeText(req.body.metaTitle),
      metaDescription: safeText(req.body.metaDescription),
      isFeatured: boolFromForm(req.body.isFeatured),
      active: boolFromForm(req.body.active),
      createdAt: new Date().toISOString()
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
    metaDescription: "Edit produk affiliate",
    canonical: `${BASE_URL}/admin/products/edit/${product.id}`,
    product
  });
});

app.post(
  "/admin/products/edit/:id",
  requireAdmin,
  upload.fields([
    { name: "imageFiles", maxCount: 10 },
    { name: "videoFiles", maxCount: 5 }
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

    const imageLinks = splitLinesToArray(req.body.imageLinks);
    const videoLinks = splitLinesToArray(req.body.videoLinks);

    const keepOldImages = req.body.keepOldImages === undefined ? true : boolFromForm(req.body.keepOldImages);
    const keepOldVideos = req.body.keepOldVideos === undefined ? true : boolFromForm(req.body.keepOldVideos);

    const oldImages = Array.isArray(old.images)
      ? old.images
      : (old.image ? [old.image] : []);

    const oldVideos = Array.isArray(old.videos) ? old.videos : [];

    const images = [
      ...(keepOldImages ? oldImages : []),
      ...uploadedImages,
      ...imageLinks
    ].filter(Boolean);

    const videos = [
      ...(keepOldVideos ? oldVideos : []),
      ...uploadedVideos,
      ...videoLinks
    ].filter(Boolean);

    const baseSlug = makeSlug(name);
    const slug = uniqueSlug(baseSlug, products, old.id);

    products[index] = {
      ...old,
      name,
      slug,
      price: Number(req.body.price || 0),
      category: safeText(req.body.category),
      desc: safeText(req.body.desc),
      image: images[0] || "",
      images,
      videos,
      affiliateUrl: safeText(req.body.affiliateUrl),
      metaTitle: safeText(req.body.metaTitle),
      metaDescription: safeText(req.body.metaDescription),
      isFeatured: boolFromForm(req.body.isFeatured),
      active: boolFromForm(req.body.active)
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
    articles
  });
});

app.get("/admin/articles/new", requireAdmin, (req, res) => {
  res.render("admin-article-form", {
    pageTitle: "Tambah Artikel",
    metaDescription: "Tambah artikel SEO",
    canonical: `${BASE_URL}/admin/articles/new`,
    article: null
  });
});

app.post("/admin/articles/new", requireAdmin, upload.single("coverFile"), (req, res) => {
  const articles = getArticles();
  const title = safeText(req.body.title);

  if (!title) {
    return res.status(400).send("Judul artikel wajib diisi");
  }

  const cover = req.file
    ? `/uploads/${req.file.filename}`
    : safeText(req.body.cover);

  const baseSlug = makeSlug(title);
  const slug = uniqueSlug(baseSlug, articles);

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
    active: boolFromForm(req.body.active),
    createdAt: new Date().toISOString()
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

  const cover = req.file
    ? `/uploads/${req.file.filename}`
    : safeText(req.body.cover) || old.cover;

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
    active: boolFromForm(req.body.active)
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
      canonical: `${BASE_URL}${req.originalUrl}`
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
