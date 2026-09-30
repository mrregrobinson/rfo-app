// Tracks whether a task has been pushed to a *specific member's* Google Tasks — a
// per-(task, user) join table, not a single flag on the task, because Google Tasks is
// personal to each Google account. A task shared with "All" might be added to Reg's
// Google Tasks but not Sheri-Dawn's, and each person needs to see their own status.
//
// This is one-way and one-time per click — the "Add to Google Tasks" button runs
// entirely client-side (a Google Identity Services token popup, see
// public/tasks.html) with no server-side Google credential or polling, so a later edit
// here, or a change made directly in Google Tasks (marking it complete, changing the
// date), does NOT sync back or forward automatically. This table only records "this
// person pushed this task to Google Tasks on this date" — it is not a live link.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_google_sync (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      google_task_id TEXT NOT NULL,
      google_task_list_id TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (task_id, user_id)
    );
  `);
};
