const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { runMigrations } = require('./migrate');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'ic.db');

// One-time escape hatch: set RESEED=true on the host to wipe and reseed on next boot
// (e.g. to recover fresh passcodes if the initial seed's console output was missed).
// Unset it again afterward so a later restart doesn't wipe real data.
if (process.env.RESEED === 'true') {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log('RESEED=true — wiped existing database, will reseed fresh on this boot.');
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

runMigrations(db, path.join(__dirname, 'migrations'));

module.exports = db;
