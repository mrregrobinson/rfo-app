// Default digest cadence settings, stored in the existing generic settings table
// (see migration 010) rather than a new table. See Section 7.1 of the build spec.
// All changeable later from the Task List admin settings panel — these are just the
// day-1 defaults so the scheduler has something to compare against immediately.
module.exports = function (db) {
  const defaults = {
    task_digest_cadence: 'weekly',
    task_digest_day_of_week: '1',
    task_digest_day_of_month: '1',
    task_digest_hour_local: '8',
    task_digest_timezone: 'America/Toronto',
    task_digest_last_sent_at: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
    }
  }
};
