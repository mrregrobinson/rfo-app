const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ic.db');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
const KEEP_LAST = 14;

if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function runBackup() {
  // Fold the WAL back into the main file first so the copy below is a complete,
  // consistent snapshot rather than a stale main file plus a separate WAL journal.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ic-${stamp}.db`;
  fs.copyFileSync(DB_PATH, path.join(BACKUPS_DIR, filename));
  pruneOldBackups();
  return filename;
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.db')).sort();
  const excess = files.length - KEEP_LAST;
  for (let i = 0; i < excess; i++) fs.unlinkSync(path.join(BACKUPS_DIR, files[i]));
}

function listBackups() {
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, f));
      return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));
}

let intervalHandle = null;
// Runs once at boot (so a fresh deploy always has at least one recent snapshot) and every
// 24h after. Failures are logged, never thrown — a backup problem must not take the app down.
function scheduleBackups() {
  try {
    runBackup();
    console.log('Startup backup complete.');
  } catch (err) {
    console.error('Startup backup failed:', err.message);
  }
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    try {
      runBackup();
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  }, 24 * 60 * 60 * 1000);
  intervalHandle.unref?.();
}

module.exports = { runBackup, listBackups, scheduleBackups, BACKUPS_DIR };
