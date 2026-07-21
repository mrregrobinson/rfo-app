// Splits the single is_admin flag into two independent axes, per the RFO Umbrella +
// Task List build spec (Section 4): a family-office-wide admin flag (member management,
// password/2FA resets) and per-application roles for Due Diligence and the Task List.
// is_admin is left in place (still read by a couple of legacy checks during rollout) but
// every permission check should migrate to these new columns.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('is_fo_admin')) db.exec('ALTER TABLE users ADD COLUMN is_fo_admin INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('dd_role')) db.exec("ALTER TABLE users ADD COLUMN dd_role TEXT NOT NULL DEFAULT 'member'");
  if (!cols.includes('tasks_role')) db.exec("ALTER TABLE users ADD COLUMN tasks_role TEXT NOT NULL DEFAULT 'member'");

  // Backfill from today's is_admin: whoever holds it becomes FO admin + admin of both
  // apps (Reg and Sheri-Dawn as of this migration); everyone else starts as a member of
  // both apps. No one defaults to viewer — see Section 4.3 of the build spec.
  db.exec(`
    UPDATE users SET is_fo_admin = 1, dd_role = 'admin', tasks_role = 'admin' WHERE is_admin = 1;
    UPDATE users SET dd_role = 'member', tasks_role = 'member' WHERE is_admin = 0;
  `);
};
