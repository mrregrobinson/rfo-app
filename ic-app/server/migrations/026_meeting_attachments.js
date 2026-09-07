// Per-meeting file attachments (PDF/Word/Excel/JPG etc.), viewable in-app. File bytes
// live on disk under data/meeting-attachments/<meetingId>/ (see server/attachments.js),
// not in this table — only metadata does, so the SQLite file itself stays small.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meeting_attachments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_at TEXT NOT NULL
    );
  `);
};
