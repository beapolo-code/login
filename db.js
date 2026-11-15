const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'data', 'app.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Intentos fallidos de login por cuenta (para alertas de seguridad).
db.exec(`
  CREATE TABLE IF NOT EXISTS failed_attempts (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migracion para bases de datos creadas con versiones anteriores.
const columns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!columns.includes('full_name')) {
  db.exec('ALTER TABLE users ADD COLUMN full_name TEXT');
}

// Unicidad sin distinguir mayusculas/minusculas (si los datos actuales lo permiten).
for (const [name, expr] of [
  ['idx_users_username_nocase', 'lower(username)'],
  ['idx_users_email_nocase', 'lower(email)'],
]) {
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON users(${expr})`);
  } catch (err) {
    console.warn(`No se pudo crear el indice ${name}: ${err.message}`);
  }
}

module.exports = db;
