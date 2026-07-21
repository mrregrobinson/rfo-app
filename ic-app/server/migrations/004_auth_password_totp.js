// Migrates the original passcode-only auth model to password + TOTP. Existing
// members' hashed passcodes become their one-time "setup code" — the credential
// that lets them claim their account and set a real password + 2FA on next login.
module.exports = function (db) {
  let cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.includes('passcode_hash') && !cols.includes('setup_code_hash')) {
    db.exec('ALTER TABLE users RENAME COLUMN passcode_hash TO setup_code_hash');
    cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  }
  const addIfMissing = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`);
  };
  addIfMissing('setup_code_hash', 'setup_code_hash TEXT');
  addIfMissing('password_hash', 'password_hash TEXT');
  addIfMissing('totp_secret', 'totp_secret TEXT');
  addIfMissing('totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
  addIfMissing('failed_attempts', 'failed_attempts INTEGER NOT NULL DEFAULT 0');
  addIfMissing('locked_until', 'locked_until TEXT');
};
