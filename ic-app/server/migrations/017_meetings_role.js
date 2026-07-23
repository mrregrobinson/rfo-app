// Third per-application role axis, alongside dd_role/tasks_role (migration 012), for the
// new Family Office Meetings module — see RFO_Meetings_App_BuildSpec_v1.docx, Section 4.
// An FO admin is always also a Meetings admin (same superset relationship as the other
// two apps); everyone else defaults to member, not viewer, matching the "no one defaults
// to viewer on day one" decision already made for dd_role/tasks_role.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('meetings_role')) db.exec("ALTER TABLE users ADD COLUMN meetings_role TEXT NOT NULL DEFAULT 'member'");
  db.exec("UPDATE users SET meetings_role = 'admin' WHERE is_fo_admin = 1");
};
