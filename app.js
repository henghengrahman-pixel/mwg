const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const slugify = require("slugify");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "123456";
const BASE_URL = process.env.BASE_URL || "https://temanbelanja.com";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");

const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const ARTICLES_FILE = path.join(DATA_DIR, "articles.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, "[]", "utf8");
if (!fs.existsSync(ARTICLES_FILE)) fs.writeFileSync(ARTICLES_FILE, "[]", "utf8");
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]", "utf8");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(PUBLIC_DIR));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "teman-belanja-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "");
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({ storage });

function readJson(file, fallback = []) {
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
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
  return slugify(String(text || ""), { lower: true, strict: true, locale: "id" });
}

function formatRupiah(n) {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

function seoTitle(title) {
  return title ? `${title} | Teman Belanja` : "Teman Belanja - Rekomendasi Belanja, Review, Promo & Affiliate";
}

function seoDescription(text, max = 160) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max - 3) + "..." : cleaned;
}

function getProducts() {
  return readJson(PRODUCTS_FILE, []);
}

function saveProducts(data) {
  writeJson(PRODUCTS_FILE, data);
}

function getArticles() {
  return readJson(ARTICLES_FILE, []);
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

app.locals.BASE_URL = BASE_URL;
app.locals.formatRupiah = formatRupiah;

// Homepage
app.get("/", (req, res) => {
  const products = getProducts()
    .filter(p => p.active !== false)
    .sort((a, b) => Number(b.isFeatured || 0) - Number(a.isFeatured || 0));

  const articles = getArticles()
    .filter(a => a.active !== false)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  res.render("home", {
    pageTitle: seoTitle(),
    metaDescription: "Teman Belanja berisi rekomendasi produk, artikel tips belanja, promo, review, dan link affiliate pilihan.",
    canonical: `${BASE_URL}/`,
    products,
    articles
  });
});

// Produk list
app.get("/produk", (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  let products = getProducts().filter(p => p.active !== false);

  if (q) {
    products = products.filter(p =>
      String(p.name || "").toLowerCase().includes(q) ||
      String(p.desc || "").toLowerCase().includes(q) ||
      String(p.category || "").toLowerCase().includes(q)
    );
  }

  res.render("products", {
    pageTitle: seoTitle("Produk Pilihan"),
    metaDescription: "Kumpulan produk pilihan di Teman Belanja lengkap dengan link affiliate, review singkat, dan rekomendasi terbaik.",
    canonical: `${BASE_URL}/produk`,
    products,
    q
  });
});

// Detail produk
app.get("/produk/:slug", (req, res) => {
  const products = getProducts();
  const product = products.find(p => p.slug === req.params.slug && p.active !== false);

  if (!product) return res.status(404).send("Produk tidak ditemukan");

  const related = products
    .filter(p => p.slug !== product.slug && p.active !== false)
    .slice(0, 4);

  res.render("product-detail", {
    pageTitle: seoTitle(product.metaTitle || product.name),
    metaDescription: seoDescription(product.metaDescription || product.desc || product.name),
    canonical: `${BASE_URL}/produk/${product.slug}`,
    product,
    related
  });
});

// Artikel list
app.get("/artikel", (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  let articles = getArticles().filter(a => a.active !== false);

  if (q) {
    articles = articles.filter(a =>
      String(a.title || "").toLowerCase().includes(q) ||
      String(a.excerpt || "").toLowerCase().includes(q) ||
      String(a.content || "").toLowerCase().includes(q)
    );
  }

  articles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.render("articles", {
    pageTitle: seoTitle("Artikel Belanja & SEO"),
    metaDescription: "Artikel Teman Belanja membahas tips belanja, review produk, rekomendasi barang, dan konten SEO yang mudah ditemukan di Google.",
    canonical: `${BASE_URL}/artikel`,
    articles,
    q
  });
});

// Detail artikel
app.get("/artikel/:slug", (req, res) => {
  const articles = getArticles();
  const article = articles.find(a => a.slug === req.params.slug && a.active !== false);

  if (!article) return res.status(404).send("Artikel tidak ditemukan");

  const related = articles
    .filter(a => a.slug !== article.slug && a.active !== false)
    .slice(0, 4);

  res.render("article-detail", {
    pageTitle: seoTitle(article.metaTitle || article.title),
    metaDescription: seoDescription(article.metaDescription || article.excerpt || article.title),
    canonical: `${BASE_URL}/artikel/${article.slug}`,
    article,
    related
  });
});

// robots.txt
app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *
Allow: /
Sitemap: ${BASE_URL}/sitemap.xml`);
});

// sitemap.xml
app.get("/sitemap.xml", (req, res) => {
  const products = getProducts().filter(p => p.active !== false);
  const articles = getArticles().filter(a => a.active !== false);

  const urls = [
    `${BASE_URL}/`,
    `${BASE_URL}/produk`,
    `${BASE_URL}/artikel`,
    ...products.map(p => `${BASE_URL}/produk/${p.slug}`),
    ...articles.map(a => `${BASE_URL}/artikel/${a.slug}`)
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${urls.map(url => `<url><loc>${url}</loc></url>`).join("")}
  </urlset>`;

  res.type("application/xml");
  res.send(xml);
});

// admin login
app.get("/admin/login", (req, res) => {
  res.render("admin-login", {
    pageTitle: "Login Admin",
    metaDescription: "Login admin Teman Belanja",
    canonical: `${BASE_URL}/admin/login`
  });
});

app.post("/admin/login", (req, res) => {
  const { id, password } = req.body;
  if (id === ADMIN_ID && password === ADMIN_PASSWORD) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  return res.send("Login gagal");
});

app.get("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

// dashboard
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

// admin products
app.get("/admin/products", requireAdmin, (req, res) => {
  res.render("admin-products", {
    pageTitle: "Admin Produk",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/products`,
    products: getProducts()
  });
});

app.get("/admin/products/new", requireAdmin, (req, res) => {
  res.render("admin-product-form", {
    pageTitle: "Tambah Produk",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/products/new`,
    product: null
  });
});

app.post("/admin/products/new", requireAdmin, upload.single("imageFile"), (req, res) => {
  const products = getProducts();

  const image = req.file
    ? `/uploads/${req.file.filename}`
    : String(req.body.image || "").trim();

  const name = String(req.body.name || "").trim();
  const slug = makeSlug(name);

  const item = {
    id: crypto.randomUUID(),
    name,
    slug,
    price: Number(req.body.price || 0),
    category: String(req.body.category || "").trim(),
    desc: String(req.body.desc || "").trim(),
    image,
    affiliateUrl: String(req.body.affiliateUrl || "").trim(),
    metaTitle: String(req.body.metaTitle || "").trim(),
    metaDescription: String(req.body.metaDescription || "").trim(),
    isFeatured: req.body.isFeatured === "on",
    active: req.body.active === "on",
    createdAt: new Date().toISOString()
  };

  products.unshift(item);
  saveProducts(products);
  res.redirect("/admin/products");
});

app.get("/admin/products/edit/:id", requireAdmin, (req, res) => {
  const product = getProducts().find(p => p.id === req.params.id);
  if (!product) return res.send("Produk tidak ditemukan");

  res.render("admin-product-form", {
    pageTitle: "Edit Produk",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/products/edit/${product.id}`,
    product
  });
});

app.post("/admin/products/edit/:id", requireAdmin, upload.single("imageFile"), (req, res) => {
  const products = getProducts();
  const index = products.findIndex(p => p.id === req.params.id);
  if (index === -1) return res.send("Produk tidak ditemukan");

  const old = products[index];
  const image = req.file
    ? `/uploads/${req.file.filename}`
    : String(req.body.image || "").trim() || old.image;

  const name = String(req.body.name || "").trim();

  products[index] = {
    ...old,
    name,
    slug: makeSlug(name),
    price: Number(req.body.price || 0),
    category: String(req.body.category || "").trim(),
    desc: String(req.body.desc || "").trim(),
    image,
    affiliateUrl: String(req.body.affiliateUrl || "").trim(),
    metaTitle: String(req.body.metaTitle || "").trim(),
    metaDescription: String(req.body.metaDescription || "").trim(),
    isFeatured: req.body.isFeatured === "on",
    active: req.body.active === "on"
  };

  saveProducts(products);
  res.redirect("/admin/products");
});

app.get("/admin/products/delete/:id", requireAdmin, (req, res) => {
  const products = getProducts().filter(p => p.id !== req.params.id);
  saveProducts(products);
  res.redirect("/admin/products");
});

// admin articles
app.get("/admin/articles", requireAdmin, (req, res) => {
  res.render("admin-articles", {
    pageTitle: "Admin Artikel",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/articles`,
    articles: getArticles()
  });
});

app.get("/admin/articles/new", requireAdmin, (req, res) => {
  res.render("admin-article-form", {
    pageTitle: "Tambah Artikel",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/articles/new`,
    article: null
  });
});

app.post("/admin/articles/new", requireAdmin, upload.single("coverFile"), (req, res) => {
  const articles = getArticles();

  const title = String(req.body.title || "").trim();
  const slug = makeSlug(title);
  const cover = req.file
    ? `/uploads/${req.file.filename}`
    : String(req.body.cover || "").trim();

  const item = {
    id: crypto.randomUUID(),
    title,
    slug,
    cover,
    excerpt: String(req.body.excerpt || "").trim(),
    content: String(req.body.content || "").trim(),
    keywords: String(req.body.keywords || "").trim(),
    metaTitle: String(req.body.metaTitle || "").trim(),
    metaDescription: String(req.body.metaDescription || "").trim(),
    active: req.body.active === "on",
    createdAt: new Date().toISOString()
  };

  articles.unshift(item);
  saveArticles(articles);
  res.redirect("/admin/articles");
});

app.get("/admin/articles/edit/:id", requireAdmin, (req, res) => {
  const article = getArticles().find(a => a.id === req.params.id);
  if (!article) return res.send("Artikel tidak ditemukan");

  res.render("admin-article-form", {
    pageTitle: "Edit Artikel",
    metaDescription: "",
    canonical: `${BASE_URL}/admin/articles/edit/${article.id}`,
    article
  });
});

app.post("/admin/articles/edit/:id", requireAdmin, upload.single("coverFile"), (req, res) => {
  const articles = getArticles();
  const index = articles.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.send("Artikel tidak ditemukan");

  const old = articles[index];
  const title = String(req.body.title || "").trim();
  const cover = req.file
    ? `/uploads/${req.file.filename}`
    : String(req.body.cover || "").trim() || old.cover;

  articles[index] = {
    ...old,
    title,
    slug: makeSlug(title),
    cover,
    excerpt: String(req.body.excerpt || "").trim(),
    content: String(req.body.content || "").trim(),
    keywords: String(req.body.keywords || "").trim(),
    metaTitle: String(req.body.metaTitle || "").trim(),
    metaDescription: String(req.body.metaDescription || "").trim(),
    active: req.body.active === "on"
  };

  saveArticles(articles);
  res.redirect("/admin/articles");
});

app.get("/admin/articles/delete/:id", requireAdmin, (req, res) => {
  const articles = getArticles().filter(a => a.id !== req.params.id);
  saveArticles(articles);
  res.redirect("/admin/articles");
});

app.listen(PORT, () => {
  console.log(`Teman Belanja running on port ${PORT}`);
});
