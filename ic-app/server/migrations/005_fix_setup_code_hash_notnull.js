// The original schema had this column as passcode_hash NOT NULL. RENAME COLUMN
// preserves that constraint, but setup_code_hash must be nullable once a member
// claims their account (it gets cleared out). SQLite can't drop a NOT NULL
// constraint in place, so rebuild the table if the legacy constraint is present.
module.exports = function (db) {
  const col = db.prepare('PRAGMA table_info(users)').all().find((c) => c.name === 'setup_code_hash');
  if (!col || !col.notnull) return;

  // Build the replacement under a different name (rather than renaming "users" out of
  // the way) so responses' FK text — which literally reads "REFERENCES users(id)" —
  // never has to be rewritten. SQLite blocks DROP TABLE on a table other tables still
  // hold a live FK reference to, so foreign key enforcement is disabled during the rebuild.
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE users_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      initials TEXT NOT NULL,
      color TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      setup_code_hash TEXT,
      password_hash TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );
    INSERT INTO users_new SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
};
