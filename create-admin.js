require("dotenv").config();
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "site.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, resolve));
(async () => {
  const username = (await ask("Admin username: ")).trim();
  const password = await ask("Admin password (minimum 12 characters): ");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 characters (letters, numbers, _, ., -).");
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  const hash = await bcrypt.hash(password, 12);
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(username, hash);
  console.log("Admin account created. Keep your credentials private.");
})().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => { rl.close(); db.close(); });
