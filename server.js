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

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const PROOF_DIR = path.join(UPLOAD_DIR, "proofs");
const QR_DIR = path.join(UPLOAD_DIR, "qr");

for (const dir of [DATA_DIR, UPLOAD_DIR, PROOF_DIR, QR_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is missing.");
}

if (!process.env.APP_ORIGIN) {
  throw new Error("APP_ORIGIN is missing.");
}

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false
}));

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

const db = new Database(path.join(DATA_DIR, "site.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
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
    reference_number TEXT NOT NULL,
    proof_filename TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    device_count INTEGER DEFAULT 1,
    transaction_id TEXT,
    payment_method TEXT DEFAULT 'GCash',
    paid_at TEXT
  );
);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(PRAGMA table_info(${table})).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(ALTER TABLE ${table} ADD COLUMN ${column} ${definition});
  }
}

ensureColumn("orders", "device_count", "INTEGER DEFAULT 1");
ensureColumn("orders", "transaction_id", "TEXT");
ensureColumn("orders", "payment_method", "TEXT DEFAULT 'GCash'");
ensureColumn("orders", "paid_at", "TEXT");
ensureColumn("orders", "reviewed_at", "TEXT");

const defaults = {
  siteName: "H2WO STORE",
  contactUrl: "https://t.me/CMH2WO",
  groupUrl: "https://t.me/+jomXsgOkv9NkMTBl",
  qrFilename: ""
};

const getSetting = db.prepare(
  "SELECT value FROM settings WHERE key = ?"
);

const saveSetting = db.prepare(
  INSERT INTO settings (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
);

for (const [key, value] of Object.entries(defaults)) {
  if (!getSetting.get(key)) {
    saveSetting.run(key, value);
  }
}

function setting(key) {
  const row = getSetting.get(key);
  return row ? row.value : defaults[key] || "";
}

const prices = {
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

function getPrice(devices, days) {
  return prices[devices]?.[days] || null;
}

function makeTransactionId() {
  const date = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);

  return H2WO-${date}-${crypto.randomBytes(3).toString("hex").toUpperCase()};
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function csrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  return req.session.csrfToken;
}

function csrfCheck(req, res, next) {
  const token = req.headers["x-csrf-token"];
if (
    !token ||
    !req.session.csrfToken ||
    token !== req.session.csrfToken
  ) {
    return res.status(403).json({
      error: "Invalid security token. Refresh the page and try again."
    });
  }

  next();
}

app.use(session({
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: DATA_DIR
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, PROOF_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ${crypto.randomUUID()}${ext});
  }
});

const proofUpload = multer({
  storage: proofStorage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  }
});

const qrStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, QR_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, gcash-${crypto.randomUUID()}${ext});
  }
});

const qrUpload = multer({
  storage: qrStorage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }

    cb(null, true);
  }
});

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({
      error: "Admin login required."
    });
  }

  next();
}

function publicOrder(order) {
  return {
    orderId: order.id,
    transactionId: order.transaction_id || "",
    username: order.username,
    devices: order.device_count,
    days: order.days,
    amount: order.amount_cents / 100,
    referenceNumber: order.reference_number,
    status: order.status,
    createdAt: order.created_at,
    paidAt: order.paid_at || null
  };
}

app.get("/api/csrf", (req, res) => {
  res.json({
    token: csrfToken(req)
  });
});

app.get("/api/public", (_req, res) => {
  const qrFilename = setting("qrFilename");
  const qrPath = qrFilename
    ? path.join(QR_DIR, path.basename(qrFilename))
    : null;

  res.json({
    siteName: setting("siteName"),
    contactUrl: setting("contactUrl"),
    groupUrl: setting("groupUrl"),
    qrUrl: qrPath && fs.existsSync(qrPath)
      ? "/api/qr"
      : null,
    prices
  });
});

app.get("/api/qr", (_req, res) => {
  const filename = setting("qrFilename");

  if (!filename) {
    return res.status(404).send("Payment QR not available.");
  }

  const filePath = path.join(QR_DIR, path.basename(filename));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Payment QR not available.");
  }

  res.sendFile(filePath);
});

app.post(
  "/api/orders",
  orderLimiter,
  (req, res, next) => {
    csrfCheck(req, res, next);
  },
  proofUpload.single("proof"),
  (req, res) => {
    try {
      const username = String(req.body.username || "").trim();
      const devices = Number(req.body.devices);
      const days = Number(req.body.days);
      const referenceNumber = String(
        req.body.referenceNumber || ""
      ).trim();

      if (!username || username.length > 80) {
        return res.status(400).json({
          error: "Please enter a valid username."
        });
      }

      if (!Number.isInteger(devices) || !Number.isInteger(days)) {
        return res.status(400).json({
          error: "Invalid package selection."
        });
      }

      const amount = getPrice(devices, days);
if (!amount) {
        return res.status(400).json({
          error: "Invalid package or duration."
        });
      }

      if (!referenceNumber || referenceNumber.length > 100) {
        return res.status(400).json({
          error: "Please enter a valid GCash reference number."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "Please upload your payment screenshot."
        });
      }

      const id = crypto.randomUUID();
      const transactionId = makeTransactionId();
      const createdAt = new Date().toISOString();

      db.prepare(
        INSERT INTO orders (
          id,
          username,
          days,
          amount_cents,
          reference_number,
          proof_filename,
          status,
          created_at,
          device_count,
          transaction_id,
          payment_method
        )
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'GCash')
      ).run(
        id,
        username,
        days,
        amount * 100,
        referenceNumber,
        req.file.filename,
        createdAt,
        devices,
        transactionId
      );

      res.status(201).json({
        message: "Order submitted successfully.",
        orderId: id,
        transactionId,
        status: "PENDING"
      });
    } catch (error) {
      console.error("Order error:", error);

      res.status(500).json({
        error: "Unable to submit order."
      });
    }
  }
);

app.get("/api/orders/:id/status", (req, res) => {
  const order = db.prepare(
    "SELECT * FROM orders WHERE id = ?"
  ).get(req.params.id);

  if (!order) {
    return res.status(404).json({
      error: "Order not found."
    });
  }

  res.json(publicOrder(order));
});

app.get("/api/orders/:id/receipt", (req, res) => {
  const order = db.prepare(
    "SELECT * FROM orders WHERE id = ?"
  ).get(req.params.id);

  if (!order) {
    return res.status(404).json({
      error: "Order not found."
    });
  }

  if (order.status !== "APPROVED" || !order.paid_at) {
    return res.status(403).json({
      error: "Receipt is available only after payment approval."
    });
  }

  res.json({
    receiptNumber: order.transaction_id,
    orderId: order.id,
    productName: H2WO Access - ${order.days} Days,
    username: order.username,
    devices: order.device_count,
    amount: order.amount_cents / 100,
    paymentMethod: order.payment_method || "GCash",
    referenceNumber: order.reference_number,
    status: "PAID",
    paidAt: order.paid_at
  });
});

/* ADMIN AUTHENTICATION */

app.post(
  "/api/admin/login",
  loginLimiter,
  csrfCheck,
  async (req, res) => {
    try {
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");

      const admin = db.prepare(
        "SELECT * FROM admins WHERE username = ?"
      ).get(username);

      if (!admin) {
        return res.status(401).json({
          error: "Invalid username or password."
        });
      }

      const valid = await bcrypt.compare(
        password,
        admin.password_hash
      );

      if (!valid) {
        return res.status(401).json({
          error: "Invalid username or password."
        });
      }

      req.session.adminId = admin.id;
      req.session.adminUsername = admin.username;

      res.json({
        message: "Login successful.",
        username: admin.username
      });
    } catch (error) {
      console.error("Admin login error:", error);

      res.status(500).json({
        error: "Login failed."
      });
    }
  }
);

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({
    loggedIn: true,
    username: req.session.adminUsername
  });
});

app.post("/api/admin/logout", requireAdmin, csrfCheck, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        error: "Unable to log out."
      });
    }

    res.clearCookie("connect.sid");

    res.json({
      message: "Logged out successfully."
    });
  });
});

/* ADMIN ORDERS */
app.get("/api/admin/orders", requireAdmin, (_req, res) => {
  const orders = db.prepare(
    "SELECT * FROM orders ORDER BY created_at DESC"
  ).all();

  res.json({
    orders: orders.map(publicOrder)
  });
});

app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  const total = db.prepare(
    SELECT COUNT(*) AS count FROM orders
  ).get().count;

  const pending = db.prepare(
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status = 'PENDING'
  ).get().count;

  const approved = db.prepare(
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status = 'APPROVED'
  ).get().count;

  const rejected = db.prepare(
    SELECT COUNT(*) AS count
    FROM orders
    WHERE status = 'REJECTED'
  ).get().count;

  const revenue = db.prepare(
    SELECT COALESCE(SUM(amount_cents), 0) AS total
    FROM orders
    WHERE status = 'APPROVED'
  ).get().total;

  res.json({
    total,
    pending,
    approved,
    rejected,
    revenue: revenue / 100
  });
});

app.get(
  "/api/admin/proofs/:filename",
  requireAdmin,
  (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(PROOF_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Proof not found.");
    }

    res.sendFile(filePath);
  }
);

app.post(
  "/api/admin/orders/:id/status",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const status = String(req.body.status || "").toUpperCase();

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({
        error: "Invalid order status."
      });
    }

    const order = db.prepare(
      "SELECT * FROM orders WHERE id = ?"
    ).get(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    const now = new Date().toISOString();

    if (status === "APPROVED") {
      db.prepare(
        UPDATE orders
        SET status = 'APPROVED',
            reviewed_at = ?,
            paid_at = ?
        WHERE id = ?
      ).run(now, now, req.params.id);
    } else {
      db.prepare(
        UPDATE orders
        SET status = 'REJECTED',
            reviewed_at = ?,
            paid_at = NULL
        WHERE id = ?
      ).run(now, req.params.id);
    }

    res.json({
      message: Order ${status.toLowerCase()}.,
      status
    });
  }
);

app.delete(
  "/api/admin/orders/:id",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const order = db.prepare(
      "SELECT * FROM orders WHERE id = ?"
    ).get(req.params.id);

    if (!order) {
      return res.status(404).json({
        error: "Order not found."
      });
    }

    db.prepare(
      "DELETE FROM orders WHERE id = ?"
    ).run(req.params.id);

    res.json({
      message: "Order deleted."
    });
  }
);

/* ADMIN SETTINGS */

app.get("/api/admin/settings", requireAdmin, (_req, res) => {
  res.json({
    siteName: setting("siteName"),
    contactUrl: setting("contactUrl"),
    groupUrl: setting("groupUrl"),
    qrUrl: setting("qrFilename") ? "/api/qr" : null
  });
});

app.post(
  "/api/admin/settings",
  requireAdmin,
  csrfCheck,
  (req, res) => {
    const siteName = String(req.body.siteName || "").trim();
    const contactUrl = String(req.body.contactUrl || "").trim();
    const groupUrl = String(req.body.groupUrl || "").trim();

    if (
      !siteName ||
      siteName.length > 60 ||
      !validUrl(contactUrl) ||
      !validUrl(groupUrl)
    ) {
      return res.status(400).json({
        error: "Please check your settings."
      });
    }

    saveSetting.run("siteName", siteName);
    saveSetting.run("contactUrl", contactUrl);
    saveSetting.run("groupUrl", groupUrl);

    res.json({
      message: "Settings saved."
    });
  }
);

app.post(
  "/api/admin/upload-qr",
  requireAdmin,
  csrfCheck,
  qrUpload.single("qr"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        error: "Please upload a QR image."
      });
    }

    const oldFilename = setting("qrFilename");
saveSetting.run("qrFilename", req.file.filename);

    if (oldFilename) {
      const oldPath = path.join(QR_DIR, path.basename(oldFilename));

      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    res.json({
      message: "GCash QR uploaded successfully.",
      qrUrl: "/api/qr"
    });
  }
);

/* CHANGE ADMIN PASSWORD */

app.post(
  "/api/admin/change-password",
  requireAdmin,
  csrfCheck,
  async (req, res) => {
    try {
      const current = String(req.body.currentPassword || "");
      const next = String(req.body.newPassword || "");

      if (next.length < 12 || next.length > 200) {
        return res.status(400).json({
          error: "New password must be at least 12 characters."
        });
      }

      const admin = db.prepare(
        "SELECT * FROM admins WHERE id = ?"
      ).get(req.session.adminId);

      if (!admin) {
        return res.status(404).json({
          error: "Admin account not found."
        });
      }

      const valid = await bcrypt.compare(
        current,
        admin.password_hash
      );

      if (!valid) {
        return res.status(400).json({
          error: "Current password is incorrect."
        });
      }

      const hash = await bcrypt.hash(next, 12);

      db.prepare(
        "UPDATE admins SET password_hash = ? WHERE id = ?"
      ).run(hash, admin.id);

      res.json({
        message: "Password changed successfully."
      });
    } catch (error) {
      console.error("Password change error:", error);

      res.status(500).json({
        error: "Unable to change password."
      });
    }
  }
);

/* FRONTEND */

app.use(express.static(path.join(ROOT, "public")));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    site: "H2WO STORE"
  });
});

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: error.message
    });
  }

  res.status(400).json({
    error: error.message || "Something went wrong."
  });
});

app.listen(PORT, () => {
  console.log(H2WO STORE running on port ${PORT});
});
