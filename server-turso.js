require("dotenv").config();

const express = require("express");
const session = require("express-session");
const { createClient } = require("@libsql/client");
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
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error("Turso database configuration is missing.");
  process.exit(1);
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters.");
  process.exit(1);
}

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.APP_ORIGIN) {
  console.error("APP_ORIGIN is required in production.");
  process.exit(1);
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const SHADOW_PRICES = {
  1: { 1: 200, 7: 400, 15: 500, 30: 600 },
  2: { 1: 400, 7: 600, 15: 800, 30: 1000, 40: 1600 },
  5: { 1: 500, 7: 1000, 15: 1500, 30: 1700, 40: 2800 }
};

const WARTK_PRICES = {
  1: 100,
  7: 250,
  30: 500
};

const asyncRoute = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

async function getSettings() {
  const result = await db.execute("SELECT key,value FROM settings");
  return Object.fromEntries(
    result.rows.map(row => [row.key, row.value])
  );
}

async function setSetting(key, value) {
  await db.execute({
    sql: `INSERT INTO settings(key,value)
          VALUES(?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    args: [key, String(value)]
  });
}

async function addOrderEvent(orderId, event, details = "") {
  await db.execute({
    sql: `INSERT INTO order_events(order_id,event,details)
          VALUES(?,?,?)`,
    args: [orderId, event, details]
  });
}

function safeDelete(filename) {
  if (!filename) return;
  const fullPath = path.join(UPLOAD_DIR, path.basename(filename));
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
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

function getWartkPrice(days) {
  const price = WARTK_PRICES[Number(days)];
  return Number.isFinite(price) ? Math.round(price * 100) : null;
}

function toIso(value) {
  return value ? String(value).replace(" ", "T") + "Z" : null;
}

function publicOrder(row) {
  return {
    id: row.id,
    transactionId: row.transaction_id || "",
    menuType: row.menu_type || "SHADOW",
    username: row.username,
    devices: Number(row.devices || 1),
    days: Number(row.days),
    amount: (Number(row.amount_cents) / 100).toFixed(2),
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

async function findOrder(id) {
  if (!UUID_RE.test(String(id))) return null;

  const result = await db.execute({
    sql: "SELECT * FROM orders WHERE id=?",
    args: [String(id)]
  });

  return result.rows[0] || null;
}

async function newTransactionId(createdAt) {
  let date = createdAt
    ? new Date(String(createdAt).replace(" ", "T") + "Z")
    : new Date();

  if (Number.isNaN(date.getTime())) date = new Date();

  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");

  for (let attempt = 0; attempt < 10; attempt++) {
    const id =
      `H2WO-${ymd}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

    const result = await db.execute({
      sql: "SELECT 1 FROM orders WHERE transaction_id=?",
      args: [id]
    });

    if (!result.rows.length) return id;
  }

  throw new Error("Could not generate a unique transaction ID.");
}

// Turso-backed Express session store
class TursoSessionStore extends session.Store {
  constructor(client) {
    super();
    this.db = client;
  }

  get(sid, callback) {
    this.db.execute({
      sql: "SELECT sess,expired FROM sessions WHERE sid=?",
      args: [sid]
    }).then(result => {
      const row = result.rows[0];

      if (!row || Number(row.expired) <= Date.now()) {
        if (row) {
          this.db.execute({
            sql: "DELETE FROM sessions WHERE sid=?",
            args: [sid]
          }).catch(() => {});
        }
        return callback(null, null);
      }

      callback(null, JSON.parse(row.sess));
    }).catch(callback);
  }

  set(sid, sess, callback = () => {}) {
    const expires = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + (sess.cookie?.maxAge || 28800000);

    this.db.execute({
      sql: `INSERT INTO sessions(sid,sess,expired)
            VALUES(?,?,?)
            ON CONFLICT(sid) DO UPDATE SET
            sess=excluded.sess, expired=excluded.expired`,
      args: [sid, JSON.stringify(sess), expires]
    }).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.db.execute({
      sql: "DELETE FROM sessions WHERE sid=?",
      args: [sid]
    }).then(() => callback(null)).catch(callback);
  }

  touch(sid, sess, callback = () => {}) {
    const expires = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + (sess.cookie?.maxAge || 28800000);

    this.db.execute({
      sql: "UPDATE sessions SET expired=? WHERE sid=?",
      args: [expires, sid]
    }).then(() => callback(null)).catch(callback);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    return res.status(401).json({ error: "Admin login required." });
  }
  next();
}

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

// SECURITY AND MIDDLEWARE
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
  store: new TursoSessionStore(db),
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
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const ext = file.mimetype === "image/png" ? ".png" : ".jpg";
    callback(null, `${crypto.randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return callback(new Error("Only JPG and PNG images are allowed."));
    }
    callback(null, true);
  }
});

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!["image/jpeg", "image/png"].includes(file.mimetype)) {
      return callback(new Error("Only JPG and PNG images are allowed."));
    }
    callback(null, true);
  }
});

// PUBLIC STORE DATA
app.get("/api/public", asyncRoute(async (_req, res) => {
  const settings = await getSettings();

  const qrExists = !!settings.qrFilename &&
    fs.existsSync(path.join(UPLOAD_DIR, path.basename(settings.qrFilename)));

  res.setHeader("Cache-Control", "no-store");
  res.json({
    siteName: settings.siteName || "H2WO STORE",
    gcashName: settings.gcashName || "",
    gcashNumber: settings.gcashNumber || "",
    prices: SHADOW_PRICES,
    wartkPrices: WARTK_PRICES,
    contactUrl: settings.contactUrl || "",
    telegramUrl: settings.telegramUrl || "",
    tiktokUrl: settings.tiktokUrl || "",
    qrUrl: qrExists
      ? `/api/qr?v=${encodeURIComponent(settings.qrFilename)}`
      : null
  });
}));

app.get("/api/csrf", (req, res) => {
  res.json({ token: csrfToken(req) });
});

// CUSTOMER ORDER SUBMISSION
app.post(
  "/api/orders",
  orderLimiter,
  csrfCheck,
  proofUpload.single("proof"),
  asyncRoute(async (req, res) => {
    try {
      const username = String(req.body.username || "").trim();
      const menuType = String(req.body.menuType || "SHADOW").trim().toUpperCase();
      const days = Number(req.body.days);
      const devices = menuType === "WARTK" ? 1 : Number(req.body.devices);
      const reference = String(req.body.referenceNumber || "").trim().slice(0, 80);

      if (!validUsername(username)) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({
          error: "Enter a valid username (maximum 40 characters)."
        });
      }

      if (!["SHADOW", "WARTK"].includes(menuType)) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({ error: "Invalid menu selection." });
      }

      if (menuType === "SHADOW" && ![1, 2, 5].includes(devices)) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({ error: "Choose 1, 2, or 5 devices." });
      }

      const amountCents = menuType === "WARTK"
        ? getWartkPrice(days)
        : getShadowPrice(devices, days);

      if (amountCents === null) {
        if (req.file) safeDelete(req.file.filename);
        return res.status(400).json({
          error: "This device and duration combination is not available."
        });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Upload your payment screenshot." });
      }

      const id = crypto.randomUUID();
      const proofExt = req.file.mimetype === "image/png" ? ".png" : ".jpg";
      const proofFilename = `${crypto.randomUUID()}${proofExt}`;
      const transactionId = await newTransactionId();
      const tx = await db.transaction("write");

      try {
        await tx.execute({
          sql: `INSERT INTO orders(
            id,username,devices,days,amount_cents,
            reference_number,proof_filename,proof_data,proof_mime,transaction_id,payment_method,menu_type
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            id, username, devices, days, amountCents,
            reference, proofFilename, req.file.buffer, req.file.mimetype, transactionId, "GCash", menuType
          ]
        });

        await tx.execute({
          sql: `INSERT INTO order_events(order_id,event,details)
                VALUES(?,?,?)`,
          args: [id, "ORDER_CREATED", "Customer submitted payment proof."]
        });

        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }

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
  })
);

// CUSTOMER ORDER STATUS
app.get("/api/orders/:id/status", statusLimiter, asyncRoute(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const order = await findOrder(req.params.id);

  if (!order) return res.status(404).json({ error: "Order not found." });

  res.json({
    status: order.status,
    paid: order.status === "APPROVED" && !!order.paid_at,
    transactionId: order.transaction_id
  });
}));

// CUSTOMER RECEIPT
app.get("/api/orders/:id/receipt", statusLimiter, asyncRoute(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const order = await findOrder(req.params.id);

  if (!order) return res.status(404).json({ error: "Order not found." });

  if (order.status !== "APPROVED" || !order.paid_at) {
    return res.status(403).json({
      error: "Receipt is available only after payment verification.",
      status: order.status
    });
  }

  const settings = await getSettings();

  res.json({
    storeName: settings.siteName || "H2WO STORE",
    transactionId: order.transaction_id,
    customerName: order.username,
    account: order.username,
    productName: `${order.menu_type || "SHADOW"} MENU - ${order.days} Day${order.days === 1 ? "" : "s"}`,
    devices: Number(order.devices || 1),
    quantity: Number(order.devices || 1),
    amount: (Number(order.amount_cents) / 100).toFixed(2),
    currency: "PHP",
    paymentMethod: order.payment_method || "GCash",
    referenceNumber: order.reference_number || "",
    paidAt: toIso(order.paid_at),
    issuedAt: new Date().toISOString(),
    status: "PAID",
    contactUrl: settings.contactUrl || ""
  });
}));

// GCASH QR IMAGE
app.get("/api/qr", asyncRoute(async (_req, res) => {
  const settings = await getSettings();

  if (!settings.qrFilename) return res.status(404).end();

  const filename = path.basename(settings.qrFilename);
  const fullPath = path.join(UPLOAD_DIR, filename);

  if (!fs.existsSync(fullPath)) return res.status(404).end();

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", 'inline; filename="gcash-qr"');
  res.sendFile(fullPath);
}));

// ADMIN LOGIN
app.post("/api/admin/login", loginLimiter, csrfCheck, asyncRoute(async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const result = await db.execute({
    sql: "SELECT * FROM admins WHERE username=?",
    args: [username]
  });

  const admin = result.rows[0];
  const valid = admin && await bcrypt.compare(password, admin.password_hash);

  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  req.session.regenerate(error => {
    if (error) {
      console.error("Session regeneration error:", error);
      return res.status(500).json({ error: "Could not create admin session." });
    }

    req.session.adminId = admin.id;
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");

    req.session.save(saveError => {
      if (saveError) {
        console.error("Session save error:", saveError);
        return res.status(500).json({ error: "Could not save admin session." });
      }

      res.json({
        message: "Logged in successfully.",
        token: req.session.csrfToken
      });
    });
  });
}));

// ADMIN LOGOUT
app.post("/api/admin/logout", requireAdmin, csrfCheck, (req, res) => {
  req.session.destroy(error => {
    if (error) return res.status(500).json({ error: "Logout failed." });
    res.clearCookie("h2wo_session");
    res.json({ message: "Logged out." });
  });
});

// ADMIN SESSION
app.get("/api/admin/me", requireAdmin, asyncRoute(async (req, res) => {
  const result = await db.execute({
    sql: "SELECT username FROM admins WHERE id=?",
    args: [req.session.adminId]
  });

  const admin = result.rows[0];

  if (!admin) {
    return res.status(401).json({ error: "Admin account not found." });
  }

  res.json({
    username: admin.username,
    token: csrfToken(req)
  });
}));

// ADMIN ORDERS
app.get("/api/admin/orders", requireAdmin, asyncRoute(async (_req, res) => {
  const result = await db.execute(`
    SELECT * FROM orders
    ORDER BY datetime(created_at) DESC
  `);

  res.json(result.rows.map(publicOrder));
}));

// ADMIN DELETE ORDER
app.delete("/api/admin/orders/:id", requireAdmin, csrfCheck, asyncRoute(async (req, res) => {
  const tx = await db.transaction("write");

  try {
    const existing = await tx.execute({
      sql: "SELECT id FROM orders WHERE id=?",
      args: [req.params.id]
    });

    if (!existing.rows.length) {
      await tx.rollback();
      return res.status(404).json({ error: "Order not found." });
    }

    await tx.execute({
      sql: "DELETE FROM order_events WHERE order_id=?",
      args: [req.params.id]
    });

    await tx.execute({
      sql: "DELETE FROM orders WHERE id=?",
      args: [req.params.id]
    });

    await tx.commit();
    res.json({ message: "Order deleted successfully." });
  } catch (error) {
    await tx.rollback().catch(() => {});
    console.error("Order deletion error:", error);
    res.status(500).json({ error: "Could not delete order." });
  }
}));

// ORDER EVENT HISTORY
app.get("/api/admin/orders/:id/events", requireAdmin, asyncRoute(async (req, res) => {
  const order = await db.execute({
    sql: "SELECT id FROM orders WHERE id=?",
    args: [req.params.id]
  });

  if (!order.rows.length) {
    return res.status(404).json({ error: "Order not found." });
  }

  const events = await db.execute({
    sql: `SELECT event,details,created_at
          FROM order_events
          WHERE order_id=?
          ORDER BY id ASC`,
    args: [req.params.id]
  });

  res.json(events.rows);
}));

// ADMIN STATISTICS
app.get("/api/admin/stats", requireAdmin, asyncRoute(async (_req, res) => {
  const result = await db.execute(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END),0) AS approved,
      COALESCE(SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END),0) AS rejected,
      COALESCE(SUM(
        CASE WHEN status='APPROVED' THEN amount_cents ELSE 0 END
      ),0) AS revenue,
      COALESCE(SUM(
        CASE WHEN status='APPROVED' AND date(paid_at)=date('now')
        THEN amount_cents ELSE 0 END
      ),0) AS todayRevenue,
      COALESCE(SUM(
        CASE WHEN status='APPROVED'
          AND strftime('%Y-%m',paid_at)=strftime('%Y-%m','now')
        THEN amount_cents ELSE 0 END
      ),0) AS monthRevenue
    FROM orders
  `);

  const counts = result.rows[0];

  res.json({
    total: Number(counts.total),
    pending: Number(counts.pending),
    approved: Number(counts.approved),
    rejected: Number(counts.rejected),
    revenue: (Number(counts.revenue) / 100).toFixed(2),
    todayRevenue: (Number(counts.todayRevenue) / 100).toFixed(2),
    monthRevenue: (Number(counts.monthRevenue) / 100).toFixed(2)
  });
}));

// ADMIN PAYMENT PROOFS
app.get("/api/admin/proofs/:filename", requireAdmin, asyncRoute(async (req, res) => {
  const filename = path.basename(req.params.filename);

  const result = await db.execute({
    sql: "SELECT proof_data, proof_mime FROM orders WHERE proof_filename=?",
    args: [filename]
  });

  if (!result.rows.length) return res.status(404).end();

  const order = result.rows[0];

  if (order.proof_data && order.proof_data.length > 0) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", order.proof_mime || "image/jpeg");
    return res.send(Buffer.from(order.proof_data));
  }

  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fullPath)) return res.status(404).end();

  res.setHeader("Cache-Control", "no-store");
  return res.sendFile(fullPath);
}));

// ADMIN APPROVE / REJECT PAYMENT
app.post(
  "/api/admin/orders/:id/status",
  requireAdmin,
  csrfCheck,
  asyncRoute(async (req, res) => {
    const status = String(req.body.status || "").toUpperCase();

    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid order status." });
    }

    const notes = String(req.body.notes || req.body.adminNotes || "")
      .trim()
      .slice(0, 500);

    const tx = await db.transaction("write");

    try {
      const current = await tx.execute({
        sql: "SELECT * FROM orders WHERE id=?",
        args: [req.params.id]
      });

      const order = current.rows[0];

      if (!order) {
        await tx.rollback();
        return res.status(404).json({ error: "Order not found." });
      }

      if (order.status !== "PENDING") {
        await tx.rollback();
        return res.status(409).json({
          error: `This order has already been ${order.status.toLowerCase()}.`
        });
      }

      if (status === "APPROVED") {
        await tx.execute({
          sql: `UPDATE orders
                SET status='APPROVED',
                    reviewed_at=CURRENT_TIMESTAMP,
                    paid_at=CURRENT_TIMESTAMP
                WHERE id=? AND status='PENDING'`,
          args: [req.params.id]
        });
      } else {
        await tx.execute({
          sql: `UPDATE orders
                SET status='REJECTED',
                    reviewed_at=CURRENT_TIMESTAMP
                WHERE id=? AND status='PENDING'`,
          args: [req.params.id]
        });
      }

      await tx.execute({
        sql: `INSERT INTO order_events(order_id,event,details)
              VALUES(?,?,?)`,
        args: [
          req.params.id,
          status === "APPROVED" ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
          notes || (status === "APPROVED"
            ? "Admin verified the payment."
            : "Admin rejected the payment.")
        ]
      });

      const updated = await tx.execute({
        sql: "SELECT * FROM orders WHERE id=?",
        args: [req.params.id]
      });

      await tx.commit();

      res.json({
        message: status === "APPROVED"
          ? "Payment verified successfully."
          : "Order rejected.",
        order: publicOrder(updated.rows[0])
      });
    } catch (error) {
      await tx.rollback().catch(() => {});
      console.error("Order status update error:", error);
      res.status(500).json({ error: "Could not update order status." });
    }
  })
);

// ADMIN SETTINGS
app.get("/api/admin/settings", requireAdmin, asyncRoute(async (_req, res) => {
  const settings = await getSettings();

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
}));

app.post(
  "/api/admin/settings",
  requireAdmin,
  csrfCheck,
  upload.single("qr"),
  asyncRoute(async (req, res) => {
    try {
      const body = req.body || {};
      const updates = {};

      if (body.siteName !== undefined) {
        const name = String(body.siteName).trim().slice(0, 60);
        if (name) updates.siteName = name;
      }

      for (const key of ["gcashName", "gcashNumber"]) {
        if (body[key] !== undefined) {
          const maxLength = key === "gcashName" ? 100 : 30;
          updates[key] = String(body[key]).trim().slice(0, maxLength);
        }
      }

      for (const key of ["price1", "price7", "price30"]) {
        if (body[key] !== undefined) {
          const price = Number(body[key]);

          if (!Number.isFinite(price) || price < 1 || price > 1000000) {
            if (req.file) safeDelete(req.file.filename);
            return res.status(400).json({ error: `Invalid ${key}.` });
          }

          updates[key] = String(Math.round(price));
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

          updates[key] = value;
        }
      }

      const oldSettings = await getSettings();

      if (req.file) {
        updates.qrFilename = req.file.filename;
      }

      const tx = await db.transaction("write");

      try {
        for (const [key, value] of Object.entries(updates)) {
          await tx.execute({
            sql: `INSERT INTO settings(key,value)
                  VALUES(?,?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [key, String(value)]
          });
        }

        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      }

      if (
        req.file &&
        oldSettings.qrFilename &&
        oldSettings.qrFilename !== req.file.filename
      ) {
        safeDelete(oldSettings.qrFilename);
      }

      res.json({
        message: "Settings saved successfully.",
        settings: await getSettings()
      });
    } catch (error) {
      if (req.file) safeDelete(req.file.filename);
      console.error("Settings update error:", error);
      res.status(500).json({ error: "Could not save settings." });
    }
  })
);

// ADMIN CHANGE PASSWORD
app.post(
  "/api/admin/change-password",
  requireAdmin,
  csrfCheck,
  asyncRoute(async (req, res) => {
    try {
      const currentPassword = String(req.body.currentPassword || "");
      const newPassword = String(req.body.newPassword || "");

      if (newPassword.length < 12) {
        return res.status(400).json({
          error: "New password must be at least 12 characters."
        });
      }

      const result = await db.execute({
        sql: "SELECT * FROM admins WHERE id=?",
        args: [req.session.adminId]
      });

      const admin = result.rows[0];

      if (!admin || !(await bcrypt.compare(
        currentPassword,
        admin.password_hash
      ))) {
        return res.status(400).json({
          error: "Current password is incorrect."
        });
      }

      const hash = await bcrypt.hash(newPassword, 12);

      await db.execute({
        sql: "UPDATE admins SET password_hash=? WHERE id=?",
        args: [hash, req.session.adminId]
      });

      console.log("[ADMIN AUDIT] Admin changed password.");

      res.json({ message: "Password changed successfully." });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Could not change password." });
    }
  })
);

// FRONTEND
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, {
    index: "index.html",
    etag: true
  }));
}

app.get(["/admin", "/admin.html"], (_req, res) => {
  res.sendFile(path.join(ROOT, "admin.html"));
});

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

// ERROR HANDLER
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
async function startServer() {
  try {
    await db.execute("SELECT 1");

    const orderColumns = await db.execute("PRAGMA table_info(orders)");
    const hasMenuType = orderColumns.rows.some(column => column.name === "menu_type");

    if (!hasMenuType) {
      await db.execute(
        "ALTER TABLE orders ADD COLUMN menu_type TEXT NOT NULL DEFAULT 'SHADOW'"
      );
      console.log("Added menu_type column. Existing orders default to SHADOW.");
    }

    const hasProofData = orderColumns.rows.some(column => column.name === "proof_data");
    if (!hasProofData) {
      await db.execute("ALTER TABLE orders ADD COLUMN proof_data BLOB");
      console.log("Added proof_data column.");
    }

    const hasProofMime = orderColumns.rows.some(column => column.name === "proof_mime");
    if (!hasProofMime) {
      await db.execute("ALTER TABLE orders ADD COLUMN proof_mime TEXT");
      console.log("Added proof_mime column.");
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expired INTEGER NOT NULL
      )
    `);

    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expired
      ON sessions(expired)
    `);

    const counts = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM admins) AS admins,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM settings) AS settings,
        (SELECT COUNT(*) FROM order_events) AS order_events
    `);

    console.log("Turso connection successful.");
    console.log("Existing records:", {
      admins: Number(counts.rows[0].admins),
      orders: Number(counts.rows[0].orders),
      settings: Number(counts.rows[0].settings),
      order_events: Number(counts.rows[0].order_events)
    });

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`H2WO STORE running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Could not start H2WO STORE:", error);
    process.exit(1);
  }
}

startServer();
