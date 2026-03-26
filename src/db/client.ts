import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

let db: ReturnType<typeof createDb> | null = null;

function getDbPath(): string {
  const dir = new URL("../../.cache", import.meta.url).pathname;
  try {
    const fs = require("node:fs");
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return `${dir}/programs.db`;
}

function createDb() {
  const sqlite = new Database(getDbPath());
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description_hash TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      entrypoint TEXT NOT NULL,
      files TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return drizzle(sqlite, { schema });
}

export function getDb() {
  if (!db) db = createDb();
  return db;
}
