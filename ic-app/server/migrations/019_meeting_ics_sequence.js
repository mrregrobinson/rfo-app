// Tracks the iCalendar SEQUENCE number for a meeting's invite (server/ics.js) — starts
// at 0, incremented each time an invite is (re)sent, so a resend after edits is
// recognized by the recipient's calendar client as an update to the same meeting
// rather than a stale duplicate of an already-processed request.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(meetings)').all().map((c) => c.name);
  if (!cols.includes('ics_sequence')) db.exec('ALTER TABLE meetings ADD COLUMN ics_sequence INTEGER NOT NULL DEFAULT 0');
};
