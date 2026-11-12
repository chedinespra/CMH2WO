
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
const PUBLIC_DIR = path.join(ROOT, "public");
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

// PRICES IN PHP
const SHADOW_PRICES = {
  1: { 1: 200, 7: 400, 15: 500, 30: 600 },
  2: { 1: 400, 7: 600, 15: 800, 30: 1000, 40: 1600 },
  5: { 1: 500, 7: 1000, 15: 1500, 30: 1700, 40: 2800 }
};

// DATABASE
const db = new Database(path.join(DATA_DIR, "site.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// Preserve an incompatible older orders table instead of deleting it.
function tableExists(name) {
  return !!db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name);
}

function getColumns(table) {
  return db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
}

if (tableExists("orders")) {
  const columns = getColumns("orders");
  const required = [
    "id",
    "username",
    "days",
    "amount_cents",
    "proof_filename",
    "status"
  ];

  const compatible = required.every(column => columns.includes(column));

  if (!compatible) {
    let backupName = "legacy_orders";
    let counter = 1;

    while (tableExists(backupName)) {
      backupName = `legacy_orders_${counter++}`;
    }

    console.warn(`Old orders table preserved as ${backupName}.`);
    db.exec(`ALTER TABLE orders RENAME TO "${backupName}"`);
  }
}

// MAIN TABLES
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
  reviewed_at TEXT,
  devices INTEGER NOT NULL DEFAULT 1,
  transaction_id TEXT,
  paid_at TEXT,
  payment_method TEXT NOT NULL DEFAULT 'GCash'
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

// ADDITIVE MIGRATIONS
function addColumnIfMissing(table, column, definition) {
  const columns = getColumns(table);

  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
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
addColumnIfMissing("orders", "reference_number", "TEXT");
addColumnIfMissing("orders", "reviewed_at", "TEXT");

// DEFAULT SETTINGS
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

// TRANSACTION IDS
function newTransactionId(createdAt) {
  let date = createdAt
    ? new Date(String(createdAt).replace(" ", "T") + "Z")
    : new Date();

  if (Number.isNaN(date.getTime())) date = new Date();

  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const exists = db.prepare(
    "SELECT 1 FROM orders WHERE transaction_id=?"
  );

  let id;

  do {
    id = `H2WO-${ymd}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  } while (exists.get(id));

  return id;
}

// Fill missing transaction IDs on older compatible records.
for (const order of db.prepare(`
  SELECT id,created_at FROM orders
  WHERE transaction_id IS NULL OR transaction_id=''
`).all()) {
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
  limit: 20,
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
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (_req, file, callback) => {
    const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
    callback(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
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

function validUsername(username) {
  return (
    typeof username === "string" &&
    username.length > 0 &&
    username.length <= 40 &&
    /^[\p{L}\p{N} _.-]+$/u.test(username)
  );
}

function getShadowPrice(devices, days) {
  const devicePrices = SHADOW_PRICES[Number(devices)];
  if (!devicePrices) return null;

  const price = devicePrices[Number(days)];
  return Number.isFinite(price) ? Math.round(price * 100) : null;
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Admin login required." });
  }

  next();
}

// CSRF
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
    return res.status(403).json({
      error: "Invalid security token. Refresh the page."
    });
  }

  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({
      error: "Security token mismatch. Refresh the page."
    });
  }

  if (isProd) {
    const origin = req.get("Origin");

    if (origin) {
      try {
        if (new URL(origin).origin !== new URL(process.env.APP_ORIGIN).origin) {
          return res.status(403).json({ error: "Invalid request origin." });
        }
      } catch {
        return res.status(403).json({ error: "Invalid request origin." });
      }
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
    proofUrl: `/api/admin/proofs/${encodeURIComponent(row.proof_filename)}`,
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
    gcashName: settings.gcashName || "",
    gcashNumber: settings.gcashNumber || "",
    prices: SHADOW_PRICES,
    contactUrl: settings.contactUrl || "",
    telegramUrl: settings.telegramUrl || "",
    tiktokUrl: settings.tiktokUrl || "",
    qrUrl: qrExists
      ? `/api/qr?v=${encodeURIComponent(settings.qrFilename)}`
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
      const reference = String(req.body.referenceNumber || "")
        .trim()
        .slice(0, 80);

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

      const saveOrder = db.transaction(() => {
        db.prepare(`
          INSERT INTO orders(
            id,username,devices,days,amount_cents,
            reference_number,proof_filename,transaction_id,payment_method
          )
          VALUES(?,?,?,?,?,?,?,?,?)
        `).run(
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

        addOrderEvent(
          id,
          "ORDER_CREATED",
          "Customer submitted payment proof."
        );
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

// CUSTOMER RECEIPT
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
    productName: `SHADOW MENU - ${order.days} Day${order.days === 1 ? "" : "s"}`,
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

// GCash QR IMAGE
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

    const valid = admin &&
      await bcrypt.compare(password, admin.password_hash);

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

      req.session.save(saveError => {
        if (saveError) {
          return res.status(500).json({
            error: "Could not save admin session."
          });
        }

        res.json({
          message: "Logged in successfully.",
          token: req.session.csrfToken
        });
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

// ORDER EVENT HISTORY
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

// ADMIN APPROVE / REJECT PAYMENT
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

    if (order.status !== "PENDING") {
      return res.status(409).json({
        error: `This order has already been ${order.status.toLowerCase()}.`
      });
    }

    const notes = String(req.body.notes || req.body.adminNotes || "")
      .trim()
      .slice(0, 500);

    try {
      const updateOrder = db.transaction(() => {
        if (status === "APPROVED") {
          db.prepare(`
            UPDATE orders
            SET status='APPROVED',
                reviewed_at=CURRENT_TIMESTAMP,
                paid_at=CURRENT_TIMESTAMP
            WHERE id=? AND status='PENDING'
          `).run(req.params.id);

          addOrderEvent(
            req.params.id,
            "PAYMENT_APPROVED",
            notes || "Admin verified the payment."
          );
        } else {
          db.prepare(`
            UPDATE orders
            SET status='REJECTED',
                reviewed_at=CURRENT_TIMESTAMP
            WHERE id=? AND status='PENDING'
          `).run(req.params.id);

          addOrderEvent(
            req.params.id,
            "PAYMENT_REJECTED",
            notes || "Admin rejected the payment."
          );
        }
      });

      updateOrder();

      const updated = db.prepare(
        "SELECT * FROM orders WHERE id=?"
      ).get(req.params.id);

      res.json({
        message: status === "APPROVED"
          ? "Payment verified successfully."
          : "Order rejected.",
        order: publicOrder(updated)
      });
    } catch (error) {
      console.error("Order status update error:", error);
      res.status(500).json({ error: "Could not update order status." });
    }
  }
);

// ADMIN SETTINGS
app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  const settings = getSettings();

  res.json({
    siteName: settings.siteName || "H2WO STORE",
    price1: settings.price1 || "200",
    price7: settings.price7 || "400",
    price30: settings.price30 || "600",
    gcashName: settings.gcashName || "",
    gcashNumber: settings.gcashNumber || "",
    contactUrl: settings.contactUrl || "",
    telegramUrl: settings.telegramUrl || "",
    tiktokUrl: settings.tiktokUrl || "",
    hasQr: !!settings.qrFilename
  });
});

app.post(
  "/api/admin/settings",
  requireAdmin,
  csrfCheck,
  upload.single("qr"),
  (req, res) => {
    try {
      const body = req.body || {};

      if (body.siteName !== undefined) {
        const name = String(body.siteName).trim().slice(0, 60);
        if (name) setSetting("siteName", name);
      }

      for (const key of ["gcashName", "gcashNumber"]) {
        if (body[key] !== undefined) {
          const maxLength = key === "gcashName" ? 100 : 30;
          setSetting(key, String(body[key]).trim().slice(0, maxLength));
        }
      }

      for (const key of ["price1", "price7", "price30"]) {
        if (body[key] !== undefined) {
          const price = Number(body[key]);

          if (!Number.isFinite(price) || price < 1 || price > 1000000) {
            if (req.file) safeDelete(req.file.filename);
            return res.status(400).json({ error: `Invalid ${key}.` });
          }

          setSetting(key, String(Math.round(price)));
        }
      }

      for (const key of ["contactUrl", "telegramUrl", "tiktokUrl"]) {
        if (body[key] !== undefined) {
          const value = String(body[key]).trim().slice(0, 500);

          if (value && !/^https:\/\/[^\s]+$/i.test(value)) {
            if (req.file) safeDelete(req.file.filename);
            return res.status(400).json({
              error: `${key} must be a valid HTTPS URL.`
            });
          }

          setSetting(key, value);
        }
      }

      if (req.file) {
        const oldQr = getSettings().qrFilename;
        setSetting("qrFilename", req.file.filename);

        if (oldQr && oldQr !== req.file.filename) {
          safeDelete(oldQr);
        }
      }

      res.json({
        message: "Settings saved successfully.",
        settings: getSettings()
      });
    } catch (error) {
      if (req.file) safeDelete(req.file.filename);

      console.error("Settings update error:", error);
      res.status(500).json({ error: "Could not save settings." });
    }
  }
);

// ADMIN CHANGE PASSWORD
app.post(
  "/api/admin/change-password",
  requireAdmin,
  csrfCheck,
  async (req, res) => {
    try {
      const currentPassword = String(req.body.currentPassword || "");
      const newPassword = String(req.body.newPassword || "");

      if (newPassword.length < 12) {
        return res.status(400).json({
          error: "New password must be at least 12 characters."
        });
      }

      const admin = db.prepare(
        "SELECT * FROM admins WHERE id=?"
      ).get(req.session.adminId);

      if (!admin || !(await bcrypt.compare(
        currentPassword,
        admin.password_hash
      ))) {
        return res.status(400).json({
          error: "Current password is incorrect."
        });
      }

      const hash = await bcrypt.hash(newPassword, 12);

      db.prepare(
        "UPDATE admins SET password_hash=? WHERE id=?"
      ).run(hash, req.session.adminId);

      addOrderEventForAdmin("ADMIN_PASSWORD_CHANGED", "Admin changed password.");

      res.json({ message: "Password changed successfully." });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Could not change password." });
    }
  }
);

// Admin security event log kept separately from customer order events.
function addOrderEventForAdmin(event, details) {
  // This event is not tied to a customer order.
  // It is intentionally not inserted into order_events.
  console.log(`[ADMIN AUDIT] ${event}: ${details}`);
}

// Prevent accidental deletion of transaction records.
// Orders are retained for permanent transaction history.

// FRONTEND
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, {
    index: "index.html",
    etag: true
  }));
}

// ADMIN PAGE
app.get(["/admin", "/admin.html"], (_req, res) => {
  res.sendFile(path.join(ROOT, "admin.html"));
});

// ADMIN JAVASCRIPT
app.get("/admin.js", (_req, res) => {
  res.sendFile(path.join(ROOT, "admin.js"));
});
// HEALTH CHECK
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 404 API HANDLER
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API endpoint not found." });
});

// UPLOAD / SERVER ERROR HANDLER
app.use((error, _req, res, _next) => {
  console.error("Server error:", error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.code === "LIMIT_FILE_SIZE"
        ? "File is too large. Maximum size is 5MB."
        : "Invalid file upload."
    });
  }

  if (error.message && error.message.includes("Only JPG and PNG")) {
    return res.status(400).json({ error: error.message });
  }

  res.status(500).json({ error: "Internal server error." });
});

// START SERVER
app.listen(PORT, "0.0.0.0", () => {
  console.log(`H2WO STORE running on port ${PORT}`);
});
