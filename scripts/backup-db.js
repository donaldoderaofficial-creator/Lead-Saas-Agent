'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const backupDir = path.resolve(process.env.BACKUP_DIR || './backups');
const files = [process.env.DB_PATH || './data.db', process.env.SESSION_DB_PATH || './sessions.sqlite', process.env.LEARNING_MODEL_PATH || './model-state.json'];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

fs.mkdirSync(backupDir, { recursive: true });
for (const source of files) {
  if (!fs.existsSync(source)) continue;
  if (source.endsWith('.db')) {
    const database = new DatabaseSync(source);
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    database.close();
  }
  fs.copyFileSync(source, path.join(backupDir, `${path.basename(source)}.${stamp}`));
}

const backups = fs.readdirSync(backupDir)
  .map((name) => ({ name, time: fs.statSync(path.join(backupDir, name)).mtimeMs }))
  .sort((first, second) => second.time - first.time);
for (const oldBackup of backups.slice(30)) fs.rmSync(path.join(backupDir, oldBackup.name));
console.log(`Backup complete: ${Math.min(backups.length, 30)} files retained`);
