import * as fs from 'fs';
import * as path from 'path';
import { getDB } from './index';

import { app } from 'electron';

export function runMigrations() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationsDir = app.isPackaged 
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(__dirname, '../../src/db/migrations');
    
  if (!fs.existsSync(migrationsDir)) {
    console.error('Migrations directory not found:', migrationsDir);
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  const getApplied = db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[];
  const appliedFiles = new Set(getApplied.map(r => r.filename));

  for (const file of files) {
    if (!appliedFiles.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      // Table-rebuild migrations (016, 021) drop and recreate tables that
      // other tables reference via foreign keys. FK enforcement is suspended
      // for the duration of the migration (each file remains atomic inside its
      // own transaction) and restored immediately after, so rebuilds succeed
      // even when child rows exist. This is the standard SQLite procedure for
      // "Making Other Kinds Of Table Schema Changes".
      db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => {
          db.exec(sql);
          db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
        })();
      } finally {
        db.pragma('foreign_keys = ON');
      }
      console.log(`Applied migration: ${file}`);
    }
  }
}
