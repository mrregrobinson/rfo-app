// Lets an opportunity accumulate more than one uploaded document over its life — the
// initial PQ report at creation (still handled by /api/claude/extract-pdf, unchanged)
// plus later follow-ups: side letters, term amendments, updated track record, additional
// diligence material. Each row is a permanent record of one upload, independent of
// whether it ended up changing anything in the opportunity's pq_data (applied_fields is
// '[]' for a reference-only upload).
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS opportunity_documents (
      id TEXT PRIMARY KEY,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      filename TEXT,
      summary TEXT DEFAULT '',
      extracted TEXT NOT NULL DEFAULT '{}',
      applied_fields TEXT NOT NULL DEFAULT '[]',
      uploaded_by TEXT NOT NULL,
      uploaded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opportunity_documents_opp ON opportunity_documents(opportunity_id, uploaded_at);
  `);
};
