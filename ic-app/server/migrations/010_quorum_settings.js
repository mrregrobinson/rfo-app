// A generic key/value settings table, seeded with a quorum_threshold: how many
// Required-role members must submit before a review is considered to have quorum for
// decision-making. Defaults to "everyone currently Required" so behaviour is unchanged
// until an admin deliberately relaxes it.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'quorum_threshold'").get();
  if (!existing) {
    const requiredCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Required'").get().n;
    db.prepare("INSERT INTO settings (key, value) VALUES ('quorum_threshold', ?)").run(String(requiredCount || 1));
  }
};
