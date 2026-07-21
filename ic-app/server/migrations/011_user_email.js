// Needed so the app can actually notify a member when something is sent to them, rather
// than only granting in-app visibility. Nullable — email notifications are best-effort
// and degrade gracefully when a member has none on file.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
};
