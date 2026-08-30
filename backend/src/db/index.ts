import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';

let dbInstance: Database.Database | null = null;

// Allow tests/utilities to point the DB at a temporary file (never from the
// renderer — this only runs in the main process).
export function getDB(): Database.Database {
  if (!dbInstance) {
    const dbPath = process.env.POS_DB_PATH
      ?? path.join(app.getPath('userData'), 'pos.db');
    dbInstance = new Database(dbPath);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
  }
  return dbInstance;
}

export function setDBPath(dbPath: string): Database.Database {
  closeDB();
  const old = process.env.POS_DB_PATH;
  process.env.POS_DB_PATH = dbPath;
  const db = getDB();
  if (old === undefined) { delete process.env.POS_DB_PATH; } else { process.env.POS_DB_PATH = old; }
  return db;
}

export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
