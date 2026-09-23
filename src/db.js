import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'schema.sql');
let db = null;

export function getDb() {
  if (db) return db;

  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  }

  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
