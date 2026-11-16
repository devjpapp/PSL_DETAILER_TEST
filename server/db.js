import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";

export function openDb(directory = process.env.DATA_DIR || "./data") {
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(directory, "psl.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(entity TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(entity,id));
    CREATE TABLE IF NOT EXISTS receipts(user_id TEXT NOT NULL, mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,mutation_id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, entity TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS masterlist_id ON records(json_extract(data,'$.externalId')) WHERE entity='hcps' AND json_extract(data,'$.masterlist')=1;
    CREATE UNIQUE INDEX IF NOT EXISTS sku_code ON records(lower(json_extract(data,'$.code'))) WHERE entity='skus';
  `);
  return db;
}
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password, hash) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    active: !!user.active,
  };
}
export function unpack(row) {
  return row
    ? {
        entity: row.entity,
        id: row.id,
        ownerId: row.owner_id,
        version: row.version,
        data: JSON.parse(row.data),
        syncedAt: row.updated_at,
      }
    : null;
}
export function canRead(user, row) {
  return (
    user.role === "admin" ||
    row.owner_id === user.id ||
    row.entity === "skus" ||
    (row.entity === "hcps" && JSON.parse(row.data).masterlist)
  );
}
