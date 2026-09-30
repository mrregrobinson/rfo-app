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

// Replaces the LIVE database with the contents of sourcePath — a local backup file or a
// temp file downloaded from Dropbox. Always takes a fresh safety snapshot of the current
// state first (via runBackup, so it shows up in the normal backups list like any other),
// since a restore is otherwise unrecoverable if it turns out to be the wrong choice.
//
// db.js opens its DatabaseSync connection once at module load and every other module
// holds that same reference directly — there's no supported way to hot-swap the
// underlying file for an already-open connection. The caller MUST process.exit() shortly
// after this returns (after sending its HTTP response) so the platform's restart policy
// brings the app back up with db.js reading the newly-restored file fresh on next boot —
// the same reasoning behind the existing RESEED=true escape hatch in db.js.
function restoreFromFile(sourcePath) {
  const safetyFilename = runBackup();
  fs.copyFileSync(sourcePath, DB_PATH);
  for (const suffix of ['-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return safetyFilename;
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

module.exports = { runBackup, listBackups, scheduleBackups, restoreFromFile, BACKUPS_DIR };
