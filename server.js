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
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");

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

// PREMIUM PACKAGE PRICES (PHP)
const PREMIUM_PRICES = {
  1: {
    1: 200,
    7: 400,
    15: 500,
    30: 600
  },
  2: {
    1: 400,
    7: 500,
    15: 650,
    30: 1000,
    40: 1600
  },
  5: {
    1: 500,
    7: 1000,
    15: 1250,
    30: 1600,
    40: 2800
  }
};

function validPlan(deviceCount, days) {
  const devices = Number(deviceCount);
  const duration = Number(days);

  return Object.prototype.hasOwnProperty.call(
    PREMIUM_PRICES,
    devices
  ) &&
  Object.prototype.hasOwnProperty.call(
    PREMIUM_PRICES[devices],
    duration
  );
}

function getPlanPrice(deviceCount, days) {
  if (!validPlan(deviceCount, days)) return null;
  return PREMIUM_PRICES[Number(deviceCount)][Number(days)];
}

// DATABASE
const db = new Database(path.join(DATA_DIR, "site.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(
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
);

// ADDITIVE DATABASE MIGRATIONS
const orderColumns = db
  .prepare("PRAGMA table_info(orders)")
  .all()
  .map(column => column.name);

if (!orderColumns.includes("device_count")) {
  db.exec(
    "ALTER TABLE orders ADD COLUMN device_count INTEGER NOT NULL DEFAULT 1"
  );
}

if (!orderColumns.includes("transaction_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN transaction_id TEXT");
}

if (!orderColumns.includes("paid_at")) {
  db.exec("ALTER TABLE orders ADD COLUMN paid_at TEXT");
}

if (!orderColumns.includes("payment_method")) {
  db.exec(
    "ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'GCash'"
  );
}

function newTransactionId(createdAt) {
  const date = createdAt
    ? new Date(String(createdAt).replace(" ", "T") + "Z")
    : new Date();

  const validDate = Number.isNaN(date.getTime())
    ? new Date()
    : date;

  const ymd = validDate
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const exists = db.prepare(
    "SELECT 1 FROM orders WHERE transaction_id = ?"
  );

  let id;

  do {
    id = H2WO-${ymd}-${crypto.randomBytes(5)
      .toString("hex")
      .toUpperCase()};
  } while (exists.get(id));

  return id;
}

for (const order of db.prepare(
  "SELECT id, created_at FROM orders WHERE transaction_id IS NULL"
).all()) {
  db.prepare(
    "UPDATE orders SET transaction_id = ? WHERE id = ?"
  ).run(newTransactionId(order.created_at), order.id);
}
db.exec(
UPDATE orders
SET paid_at = COALESCE(reviewed_at, created_at)
WHERE status = 'APPROVED' AND paid_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_transaction_id
ON orders(transaction_id);
);

// DEFAULT SETTINGS
const defaults = {
  siteName: "H2WO STORE",
  qrFilename: "",
  contactUrl: "https://t.me/CMH2WO"
};

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)"
);

for (const [key, value] of Object.entries(defaults)) {
  insertSetting.run(key, value);
}

function getSettings() {
  const rows = db.prepare(
    "SELECT key, value FROM settings"
  ).all();

  return Object.fromEntries(
    rows.map(row => [row.key, row.value])
  );
}

function setSetting(key, value) {
  db.prepare(
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  ).run(key, String(value));
}

// SECURITY
app.disable("x-powered-by");
app.set("trust proxy", isProd ? 1 : false);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: {
    policy: "same-site"
  }
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({
  extended: false,
  limit: "20kb"
}));

app.use(session({
  name: "h2wo_admin_session",
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

// IMAGE UPLOAD
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      const ext = file.mimetype === "image/png"
        ? ".png"
        : ".jpg";

      cb(null, ${crypto.randomUUID()}${ext});
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/jpeg",
      "image/png"
    ];

    if (!allowed.includes(file.mimetype)) {
      return cb(
        new Error("Only JPG, JPEG, and PNG images are allowed.")
      );
    }

    cb(null, true);
  }
});

// MIDDLEWARE
function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}

function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto
      .randomBytes(32)
      .toString("hex");
  }

  return req.session.csrfToken;
}

function csrfCheck(req, res, next) {
  const token = req.get("x-csrf-token");

  if (
    !req.session.csrfToken ||
    !token ||
    token !== req.session.csrfToken
  ) {
    return res.status(403).json({
      error: "Invalid security token. Please refresh and try again."
    });
  }

  next();
}

function safeDelete(filename) {
  if (!filename) return;

  const fullPath = path.join(
    UPLOAD_DIR,
    path.basename(filename)
  );

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

function publicOrder(row) {
  return {
    id: row.id,
Telegram
𝐂𝐌 𝐇2𝐖𝐎
VIEW MESSAGE
transactionId: row.transaction_id || "",
    username: row.username,
    deviceCount: row.device_count || 1,
    days: row.days,
    amount: (row.amount_cents / 100).toFixed(2),
    referenceNumber: row.reference_number || "",
    proofUrl: /api/admin/proofs/${encodeURIComponent(
      row.proof_filename
    )},
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  };
}

// PUBLIC API
app.get("/api/public", (req, res) => {
  const settings = getSettings();

  const qrExists = !!settings.qrFilename &&
    fs.existsSync(
      path.join(
        UPLOAD_DIR,
        path.basename(settings.qrFilename)
      )
    );

  res.json({
    siteName: settings.siteName || "H2WO STORE",
    prices: PREMIUM_PRICES,
    contactUrl: settings.contactUrl || "",
    qrUrl: qrExists
      ? /api/qr?v=${encodeURIComponent(settings.qrFilename)}
      : null
  });
});

app.get("/api/csrf", (req, res) => {
  res.json({
    token: csrfToken(req)
  });
});

// CREATE CUSTOMER ORDER
app.post(
  "/api/orders",
  orderLimiter,
  csrfCheck,
  upload.single("proof"),
  (req, res) => {
    try {
      const username = String(
        req.body.username || ""
      ).trim();

      const deviceCount = Number(
        req.body.deviceCount
      );

      const days = Number(req.body.days);

      const reference = String(
        req.body.referenceNumber || ""
      ).trim().slice(0, 80);

      if (
        !username ||
        username.length > 40 ||
        !/^[\p{L}\p{N} _.-]+$/u.test(username)
      ) {
        if (req.file) safeDelete(req.file.filename);

        return res.status(400).json({
          error: "Enter a valid username (maximum 40 characters)."
        });
      }

      if (!validPlan(deviceCount, days)) {
        if (req.file) safeDelete(req.file.filename);

        return res.status(400).json({
          error: "Invalid device package or duration."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Upload your payment screenshot."
        });
      }

      // NEVER TRUST THE CLIENT-SUBMITTED PRICE
      const amount = getPlanPrice(deviceCount, days);
      const amountCents = amount * 100;

      const id = crypto.randomUUID();
      const transactionId = newTransactionId();

      db.prepare(
        INSERT INTO orders (
          id,
          username,
          days,
          device_count,
          amount_cents,
          reference_number,
          proof_filename,
          transaction_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ).run(
        id,
        username,
        days,
        deviceCount,
        amountCents,
        reference,
        req.file.filename,
        transactionId
      );

      res.status(201).json({
        message: "Payment submitted successfully! Please wait for admin verification.",
        orderId: id,
        transactionId,
        deviceCount,
        days,
        amount: amount.toFixed(2)
      });

    } catch (err) {
      if (req.file) safeDelete(req.file.filename);

      console.error(err);

      res.status(500).json({
        error: "Unable to submit order."
      });
    }
  }
);

// CUSTOMER STATUS AND RECEIPT
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findOrder(id) {
  if (!UUID_RE.test(String(id))) return null;

  return db.prepare(
    "SELECT * FROM orders WHERE id = ?"
  ).get(String(id)) || null;
}

function toIso(value) {
  return value
    ? String(value).replace(" ", "T") + "Z"
    : null;
}

app.get(
  "/api/orders/:id/status",
  statusLimiter,
  (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const order = findOrder(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    res.json({
      status: order.status,
      paid: order.status === "APPROVED" && !!order.paid_at,
      transactionId: order.transaction_id
    });
  }
);
app.get(
  "/api/orders/:id/receipt",
  statusLimiter,
  (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    const order = findOrder(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    if (
      order.status !== "APPROVED" ||
      !order.paid_at
    ) {
      return res.status(403).json({
        error: "Receipt is available only after your payment has been verified.",
        status: order.status
      });
    }

    const deviceCount = order.device_count || 1;

    res.json({
      transactionId: order.transaction_id,
      customerName: order.username,
      account: order.username,
      productName: H2WO PREMIUM - ${deviceCount} Device${deviceCount === 1 ? "" : "s"} - ${order.days} Days,
      deviceCount,
      days: order.days,
      quantity: deviceCount,
      amount: (order.amount_cents / 100).toFixed(2),
      paymentMethod: order.payment_method || "GCash",
      referenceNumber: order.reference_number || "",
      paidAt: toIso(order.paid_at),
      issuedAt: new Date().toISOString(),
      status: "PAID",
      contactUrl: getSettings().contactUrl || ""
    });
  }
);

// QR CODE
app.get("/api/qr", (req, res) => {
  const settings = getSettings();

  if (!settings.qrFilename) {
    return res.status(404).end();
  }

  const file = path.join(
    UPLOAD_DIR,
    path.basename(settings.qrFilename)
  );

  if (!fs.existsSync(file)) {
    return res.status(404).end();
  }

  res.setHeader(
    "Content-Disposition",
    'inline; filename="gcash-qr.png"'
  );

  res.sendFile(file);
});

// ADMIN LOGIN
app.post(
  "/api/admin/login",
  loginLimiter,
  csrfCheck,
  async (req, res) => {
    const username = String(
      req.body.username || ""
    ).trim();

    const password = String(
      req.body.password || ""
    );

    const admin = db.prepare(
      "SELECT * FROM admins WHERE username = ?"
    ).get(username);

    const ok = admin &&
      await bcrypt.compare(password, admin.password_hash);

    if (!ok) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    req.session.regenerate(err => {
      if (err) {
        return res.status(500).json({
          error: "Could not create session."
        });
      }

      req.session.adminId = admin.id;
      req.session.csrfToken = crypto
        .randomBytes(32)
        .toString("hex");

      res.json({
        message: "Logged in.",
        token: req.session.csrfToken
      });
    });
  }
);

app.post(
  "/api/admin/logout",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    req.session.destroy(err => {
      if (err) {
        return res.status(500).json({
          error: "Could not log out."
        });
      }

      res.clearCookie("h2wo_admin_session");

      res.json({
        message: "Logged out."
      });
    });
  }
);

app.get(
  "/api/admin/me",
  requireAdmin,
  (req, res) => {
    const admin = db.prepare(
      "SELECT username FROM admins WHERE id = ?"
    ).get(req.session.adminId);

    if (!admin) {
      return res.status(401).json({
        error: "Admin account not found."
      });
    }

    res.json({
      username: admin.username,
      token: csrfToken(req)
    });
  }
);

// ADMIN ORDERS
app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {
    const rows = db.prepare(
      SELECT *
      FROM orders
      ORDER BY datetime(created_at) DESC
    ).all();

    res.json(rows.map(publicOrder));
  }
);

// ADMIN STATISTICS
app.get(
  "/api/admin/stats",
  requireAdmin,
  (req, res) => {
    const counts = db.prepare(
      SELECT
        COUNT(*) AS total,
        SUM(status = 'PENDING') AS pending,
        SUM(status = 'APPROVED') AS approved,
        SUM(status = 'REJECTED') AS rejected,
        COALESCE(
          SUM(
            CASE
              WHEN status = 'APPROVED'
              THEN amount_cents
              ELSE 0
            END
          ),
          0
        ) AS revenue
      FROM orders
    ).get();
res.json({
      total: counts.total || 0,
      pending: counts.pending || 0,
      approved: counts.approved || 0,
      rejected: counts.rejected || 0,
      revenue: (counts.revenue / 100).toFixed(2)
    });
  }
);

// ADMIN PAYMENT PROOFS
app.get(
  "/api/admin/proofs/:filename",
  requireAdmin,
  (req, res) => {
    const filename = path.basename(
      req.params.filename
    );

    const row = db.prepare(
      "SELECT id FROM orders WHERE proof_filename = ?"
    ).get(filename);

    if (!row) return res.status(404).end();

    const fullPath = path.join(
      UPLOAD_DIR,
      filename
    );

    if (!fs.existsSync(fullPath)) {
      return res.status(404).end();
    }

    res.setHeader("Cache-Control", "no-store");
    res.sendFile(fullPath);
  }
);

// APPROVE OR REJECT ORDER
app.post(
  "/api/admin/orders/:id/status",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const status = String(
      req.body.status || ""
    );

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        error: "Invalid status."
      });
    }

    const result = status === "APPROVED"
      ? db.prepare(
          UPDATE orders
          SET
            status = 'APPROVED',
            reviewed_at = CURRENT_TIMESTAMP,
            paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
          WHERE id = ?
        ).run(req.params.id)
      : db.prepare(
          UPDATE orders
          SET
            status = 'REJECTED',
            reviewed_at = CURRENT_TIMESTAMP,
            paid_at = NULL
          WHERE id = ?
        ).run(req.params.id);

    if (!result.changes) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    res.json({
      message: Order ${status.toLowerCase()}.
    });
  }
);

// DELETE ORDER
app.delete(
  "/api/admin/orders/:id",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const row = db.prepare(
      "SELECT proof_filename FROM orders WHERE id = ?"
    ).get(req.params.id);

    if (!row) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    db.prepare(
      "DELETE FROM orders WHERE id = ?"
    ).run(req.params.id);

    safeDelete(row.proof_filename);

    res.json({
      message: "Order deleted."
    });
  }
);

// ADMIN SETTINGS
// Package prices are fixed on the server and cannot be changed by the browser.
app.put(
  "/api/admin/settings",
  requireAdmin,
  csrfCheck,
  upload.single("qr"),
  (req, res) => {
    const siteName = String(
      req.body.siteName || ""
    ).trim().slice(0, 50);

    if (!siteName) {
      if (req.file) safeDelete(req.file.filename);

      return res.status(400).json({
        error: "Enter a valid site name."
      });
    }

    const contactUrl = req.body.contactUrl === undefined
      ? null
      : String(req.body.contactUrl).trim();

    if (
      contactUrl !== null &&
      contactUrl !== "" &&
      !/^https:\/\/[^\s<>"']{3,200}$/i.test(contactUrl)
    ) {
      if (req.file) safeDelete(req.file.filename);

      return res.status(400).json({
        error: "Contact link must start with https://."
      });
    }

    const oldQr = getSettings().qrFilename;

    setSetting("siteName", siteName);

    if (contactUrl !== null) {
      setSetting("contactUrl", contactUrl);
    }

    if (req.file) {
      setSetting("qrFilename", req.file.filename);

      if (oldQr && oldQr !== req.file.filename) {
        safeDelete(oldQr);
      }
    }

    res.json({
      message: "Settings saved."
    });
  }
);

// CHANGE ADMIN PASSWORD
app.post(
  "/api/admin/change-password",
  requireAdmin,
  csrfCheck,
  async (req, res) => {
    const current = String(
      req.body.currentPassword || ""
    );

    const next = String(
      req.body.newPassword || ""
    );

    if (next.length < 12 || next.length > 200) {
      return res.status(400).json({
        error: "New password must be at least 12 characters."
      });
    }

    const admin = db.prepare(
      "SELECT * FROM admins WHERE id = ?"
    ).get(req.session.adminId);
if (!admin || !await
