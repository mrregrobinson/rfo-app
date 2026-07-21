module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(opportunities)').all().map((c) => c.name);
  if (!cols.includes('research')) {
    db.exec("ALTER TABLE opportunities ADD COLUMN research TEXT NOT NULL DEFAULT '{}'");
  }
};
