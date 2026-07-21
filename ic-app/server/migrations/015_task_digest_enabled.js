// The digest defaulted to "on" (weekly) as soon as the schema existed, with no way to
// try it first. Adds an explicit enabled/disabled switch, defaulting to disabled, so a
// Task List admin can send themselves a test email and review it before turning on the
// recurring send to everyone.
module.exports = function (db) {
  const existing = db.prepare("SELECT value FROM settings WHERE key = 'task_digest_enabled'").get();
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('task_digest_enabled', '0')").run();
  }
};
