require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters.");
  process.exit(1);
}

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.APP_ORIGIN) {
  console.error("APP_ORIGIN is required in production.");
  process.exit(1);
}

// SHADOW MENU PRICES - Philippine Peso
const SHADOW_PRICES = {
  1: {
    1: 200,
    7: 400,
    15: 500,
    30: 600
  },
  2: {
    1: 400,
    7: 600,
    15: 800,
    30: 1000,
    40: 1600
  },
  5: {
    1: 500,
    7: 1000,
    15: 1500,
    30: 1700,
    40: 2800
  }
};

// DATABASE
const db = new Database(path.join(DATA_DIR, "site.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  days INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  reference_number TEXT,
  proof_filename TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  event TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);

// ADDITIVE MIGRATIONS - existing records are preserved
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(PRAGMA table_info(${table})).all();
  if (!columns.some(col => col.name === column)) {
    db.exec(ALTER TABLE ${table} ADD COLUMN ${column} ${definition});
  }
}

addColumnIfMissing("orders", "devices", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("orders", "transaction_id", "TEXT");
addColumnIfMissing("orders", "paid_at", "TEXT");
addColumnIfMissing(
  "orders",
  "payment_method",
  "TEXT NOT NULL DEFAULT 'GCash'"
);

const defaults = {
  siteName: "H2WO STORE",
  price1: "200",
  price7: "400",
  price30: "600",
  qrFilename: "",
  contactUrl: "https://t.me/+jomXsgOkv9NkMTBl",
  telegramUrl: "https://t.me/+jomXsgOkv9NkMTBl",
  tiktokUrl: "https://www.tiktok.com/@officialchinro"
};

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)"
);

for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

function getSettings() {
  const rows = db.prepare("SELECT key,value FROM settings").all();
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key,value)
    VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value));
}

// TRANSACTION ID MIGRATION
function newTransactionId(createdAt) {
  const date = createdAt
    ? new Date(String(createdAt).replace(" ", "T") + "Z")
    : new Date();

  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const ymd = validDate.toISOString().slice(0, 10).replace(/-/g, "");

  const exists = db.prepare(
    "SELECT 1 FROM orders WHERE transaction_id=?"
  );

  let id;

  do {
    id = H2WO-${ymd}-${crypto.randomBytes(5).toString("hex").toUpperCase()};
  } while (exists.get(id));

  return id;
}

for (const order of db.prepare(
  "SELECT id,created_at FROM orders WHERE transaction_id IS NULL OR transaction_id=''"
).all()) {
  db.prepare(
    "UPDATE orders SET transaction_id=? WHERE id=?"
  ).run(newTransactionId(order.created_at), order.id);
}

db.exec(`
  UPDATE orders
  SET paid_at=COALESCE(reviewed_at,created_at)
  WHERE status='APPROVED' AND paid_at IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transaction_id
  ON orders(transaction_id);

  CREATE INDEX IF NOT EXISTS idx_orders_created_at
  ON orders(created_at);

  CREATE INDEX IF NOT EXISTS idx_orders_status
  ON orders(status);

  CREATE INDEX IF NOT EXISTS idx_order_events_order_id
  ON order_events(order_id);
`);

// SECURITY
app.disable("x-powered-by");
app.set("trust proxy", isProd ? 1 : false);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: "same-site" }
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

app.use(session({
  name: "h2wo_session",
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const statusLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

// FILE UPLOAD
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, UPLOAD_DIR);
    },
    filename: (_req, file, callback) => {
      const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
      callback(null, ${crypto.randomUUID()}${ext});
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    const allowed = ["image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype)) {
      return callback(new Error("Only JPG and PNG images are allowed."));
    }
    callback(null, true);
  }
});

function safeDelete(filename) {
  if (!filename) return;

  const fullPath = path.join(UPLOAD_DIR, path.basename(filename));

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

function parsePrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 1 || number > 1000000) {
    return null;
  }

  return Math.round(number * 100);
}

function getShadowPrice(devices, days) {
  const devicePrices = SHADOW_PRICES[Number(devices)];
  if (!devicePrices) return null;

  const price = devicePrices[Number(days)];
  return Number.isFinite(price) ? Math.round(price * 100) : null;
}

function validUsername(username) {
  return (
    username.length > 0 &&
    username.length <= 40 &&
    /^[\p{L}\p{N} _.-]+$/u.test(username)
  );
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

// CSRF PROTECTION
function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrfToken;
}

function csrfCheck(req, res, next) {
  const supplied = req.get("X-CSRF-Token");
  const expected = req.session.csrfToken;

  if (!supplied || !expected) {
    return res.status(403).json({ error: "Invalid security token. Refresh the page." });
  }

  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Security token mismatch. Refresh the page." });
  }

  if (isProd && req.get("Origin")) {
    try {
      const origin = new URL(req.get("Origin")).origin;
      const expectedOrigin = new URL(process.env.APP_ORIGIN).origin;

      if (origin !== expectedOrigin) {
        return res.status(403).json({ error: "Invalid request origin." });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request origin." });
    }
  }

  next();
}

// ORDER HELPERS
function addOrderEvent(orderId, event, details = "") {
  db.prepare(`
    INSERT INTO order_events(order_id,event,details)
    VALUES(?,?,?)
  `).run(orderId, event, details);
}

function publicOrder(row) {
  return {
    id: row.id,
    transactionId: row.transaction_id || "",
    username: row.username,
    devices: Number(row.devices || 1),
    days: Number(row.days),
    amount: (row.amount_cents / 100).toFixed(2),
    referenceNumber: row.reference_number || "",
    proofUrl: /api/admin/proofs/${encodeURIComponent(row.proof_filename)},
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    paidAt: row.paid_at || null
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findOrder(id) {
  if (!UUID_RE.test(String(id))) return null;

  return db.prepare(
    "SELECT * FROM orders WHERE id=?"
  ).get(String(id)) || null;
}

function toIso(value) {
  return value ? String(value).replace(" ", "T") + "Z" : null;
}

// PUBLIC STORE DATA
app.get("/api/public", (_req, res) => {
  const settings = getSettings();

  const qrExists =
    !!settings.qrFilename &&
    fs.existsSync(path.join(UPLOAD_DIR, path.basename(settings.qrFilename)));

  res.setHeader("Cache-Control", "no-store");

  res.json({
    siteName: settings.siteName || "H2WO STORE",
    prices: SHADOW_PRICES,
    contactUrl: settings.contactUrl || "",
    telegramUrl: settings.telegramUrl || "",
    tiktokUrl: settings.tiktokUrl || "",
    qrUrl: qrExists
      ? /api/qr?v=${encodeURIComponent(settings.qrFilename)}
      : null
  });
});

app.get("/api/csrf", (req, res) => {
  res.json({ token: csrfToken(req) });
});

// CUSTOMER ORDER SUBMISSION
app.post(
  "/api/orders",
  orderLimiter,
  csrfCheck,
  upload.single("proof"),
  (req, res) => {
    try {
      const username = String(req.body.username || "").trim();
      const devices = Number(req.body.devices);
      const days = Number(req.body.days);
      const reference = String(req.body.referenceNumber || "").trim().slice(0, 80);

      if (!validUsername(username)) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({
          error: "Enter a valid username (maximum 40 characters)."
        });
      }

      if (![1, 2, 5].includes(devices)) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({
          error: "Choose 1, 2, or 5 devices."
        });
      }

      const amountCents = getShadowPrice(devices, days);

      if (amountCents === null) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({
          error: "This device and duration combination is not available."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Upload your payment screenshot."
        });
      }

      const id = crypto.randomUUID();
      const transactionId = newTransactionId();

      const insertOrder = db.prepare(`
        INSERT INTO orders(
          id,username,devices,days,amount_cents,
          reference_number,proof_filename,transaction_id,payment_method
        )
        VALUES(?,?,?,?,?,?,?,?,?)
      `);

      const saveOrder = db.transaction(() => {
        insertOrder.run(
          id,
          username,
          devices,
          days,
          amountCents,
          reference,
          req.file.filename,
          transactionId,
          "GCash"
        );

        addOrderEvent(id, "ORDER_CREATED", "Customer submitted payment proof.");
      });

      saveOrder();

      res.status(201).json({
        message: "Payment submitted successfully. Please wait for admin verification.",
        orderId: id,
        transactionId
      });
    } catch (error) {
      if (req.file) safeDelete(req.file.filename);
      console.error("Order submission error:", error);

      res.status(500).json({ error: "Unable to submit order." });
    }
  }
);

// CUSTOMER ORDER STATUS
app.get("/api/orders/:id/status", statusLimiter, (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  res.json({
    status: order.status,
    paid: order.status === "APPROVED" && !!order.paid_at,
    transactionId: order.transaction_id
  });
});

// CUSTOMER RECEIPT DATA
app.get("/api/orders/:id/receipt", statusLimiter, (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const order = findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  if (order.status !== "APPROVED" || !order.paid_at) {
    return res.status(403).json({
      error: "Receipt is available only after payment verification.",
      status: order.status
    });
  }

  res.json({
    storeName: getSettings().siteName || "H2WO STORE",
    transactionId: order.transaction_id,
    customerName: order.username,
    account: order.username,
    productName: SHADOW MENU - ${order.days} Day${order.days === 1 ? "" : "s"},
    devices: Number(order.devices || 1),
    quantity: Number(order.devices || 1),
    amount: (order.amount_cents / 100).toFixed(2),
    currency: "PHP",
    paymentMethod: order.payment_method || "GCash",
    referenceNumber: order.reference_number || "",
    paidAt: toIso(order.paid_at),
    issuedAt: new Date().toISOString(),
    status: "PAID",
    contactUrl: getSettings().contactUrl || ""
  });
});

// QR IMAGE
app.get("/api/qr", (_req, res) => {
  const settings = getSettings();

  if (!settings.qrFilename) {
    return res.status(404).end();
  }

  const filename = path.basename(settings.qrFilename);
  const fullPath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).end();
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'inline; filename="gcash-qr"');
  res.sendFile(fullPath);
});

// ADMIN LOGIN
app.post("/api/admin/login", loginLimiter, csrfCheck, async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const admin = db.prepare(
      "SELECT * FROM admins WHERE username=?"
    ).get(username);

    const valid = admin && await bcrypt.compare(password, admin.password_hash);

    if (!valid) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    req.session.regenerate(error => {
      if (error) {
        return res.status(500).json({
          error: "Could not create admin session."
        });
      }

      req.session.adminId = admin.id;
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");

      res.json({
        message: "Logged in successfully.",
        token: req.session.csrfToken
      });
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed." });
  }
});

// ADMIN LOGOUT
app.post("/api/admin/logout", requireAdmin, csrfCheck, (req, res) => {
  req.session.destroy(error => {
    if (error) {
      return res.status(500).json({ error: "Logout failed." });
    }

    res.clearCookie("h2wo_session");
    res.json({ message: "Logged out." });
  });
});

// ADMIN SESSION
app.get("/api/admin/me", requireAdmin, (req, res) => {
  const admin = db.prepare(
    "SELECT username FROM admins WHERE id=?"
  ).get(req.session.adminId);

  if (!admin) {
    return res.status(401).json({ error: "Admin account not found." });
  }

  res.json({
    username: admin.username,
    token: csrfToken(req)
  });
});

// ADMIN ORDERS
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM orders
    ORDER BY datetime(created_at) DESC
  `).all();

  res.json(rows.map(publicOrder));
});

// ADMIN TRANSACTION HISTORY / AUDIT TRAIL
app.get("/api/admin/orders/:id/events", requireAdmin, (req, res) => {
  const order = db.prepare(
    "SELECT id FROM orders WHERE id=?"
  ).get(req.params.id);

  if (!order) {
    return res.status(404).json({ error: "Order not found." });
  }

  const events = db.prepare(`
    SELECT event,details,created_at
    FROM order_events
    WHERE order_id=?
    ORDER BY id ASC
  `).all(req.params.id);

  res.json(events);
});

// ADMIN STATISTICS
app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(status='PENDING'),0) AS pending,
      COALESCE(SUM(status='APPROVED'),0) AS approved,
      COALESCE(SUM(status='REJECTED'),0) AS rejected,

      COALESCE(SUM(
        CASE WHEN status='APPROVED'
        THEN amount_cents ELSE 0 END
      ),0) AS revenue,

      COALESCE(SUM(
        CASE WHEN status='APPROVED'
          AND date(paid_at)=date('now')
        THEN amount_cents ELSE 0 END
      ),0) AS todayRevenue,

      COALESCE(SUM(
        CASE WHEN status='APPROVED'
          AND strftime('%Y-%m',paid_at)=strftime('%Y-%m','now')
        THEN amount_cents ELSE 0 END
      ),0) AS monthRevenue

    FROM orders
  `).get();

  res.json({
    total: counts.total,
    pending: counts.pending,
    approved: counts.approved,
    rejected: counts.rejected,
    revenue: (counts.revenue / 100).toFixed(2),
    todayRevenue: (counts.todayRevenue / 100).toFixed(2),
    monthRevenue: (counts.monthRevenue / 100).toFixed(2)
  });
});

// ADMIN PAYMENT PROOFS
app.get("/api/admin/proofs/:filename", requireAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);

  const order = db.prepare(
    "SELECT id FROM orders WHERE proof_filename=?"
  ).get(filename);

  if (!order) {
    return res.status(404).end();
  }

  const fullPath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).end();
  }

  res.setHeader("Cache-Control", "no-store");
  res.sendFile(fullPath);
});

// ADMIN APPROVE / REJECT
app.post(
  "/api/admin/orders/:id/status",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const status = String(req.body.status || "").toUpperCase();

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid order status." });
    }

    const order = db.prepare(
      "SELECT * FROM orders WHERE id=?"
    ).get(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    const updateOrder = db.transaction(() => {
      if (status === "APPROVED") {
        db.prepare(`
          UPDATE orders
          SET status='APPROVED',
              reviewed_at=CURRENT_TIMESTAMP,
              paid_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).run(req.params.id);

        addOrderEvent(
          req.params.id,
          "PAYMENT_APPROVED",
          "Admin verified the payment."
