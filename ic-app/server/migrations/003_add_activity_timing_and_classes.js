module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(activities)').all().map((c) => c.name);
  if (!cols.includes('timing')) db.exec("ALTER TABLE activities ADD COLUMN timing TEXT NOT NULL DEFAULT 'Uncertain'");
  if (!cols.includes('decrease_class')) db.exec('ALTER TABLE activities ADD COLUMN decrease_class TEXT');
  if (!cols.includes('increase_class')) db.exec('ALTER TABLE activities ADD COLUMN increase_class TEXT');
};
