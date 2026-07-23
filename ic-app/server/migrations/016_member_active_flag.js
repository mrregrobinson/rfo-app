// Supports deactivating a member instead of hard-deleting them — a hard DELETE would
// violate foreign key references from opportunities.initiated_by, responses.user_id,
// tasks.created_by, task_assignees.user_id, activities.created_by, and audit_log, and
// would erase the historical record of who reviewed/decided what. Deactivated members
// are blocked from logging in but keep their name attached to past records.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('is_active')) db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
};
