// Extends the existing "ask Claude to refresh wording before a round opens" feature
// (maturity_descriptor_suggestions, migration 033) to the QUESTION SET too. Until now,
// that feature only researched and proposed refreshed language for the five level
// descriptors — the four questions members actually answer stayed a fully standardized
// template (server/maturity-seed-data.js questionsForService), reworded only by
// substituting the service name in. This is a real gap: the same generic questions on
// every one of the 16 services is not a service-specific instrument.
//
// maturity_question_suggestions mirrors maturity_descriptor_suggestions' shape (a review
// queue; nothing is applied without an admin accept) but targets a specific
// maturity_questions row directly via question_id, since questions (unlike level
// descriptors, which are keyed by service_id+level) are their own real rows with a stable
// id — sort_order alone isn't a safe key if questions are ever reordered or added to.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maturity_question_suggestions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      question_id TEXT NOT NULL REFERENCES maturity_questions(id),
      current_prompt TEXT NOT NULL,
      current_help_text TEXT NOT NULL DEFAULT '',
      suggested_prompt TEXT NOT NULL,
      suggested_help_text TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted' | 'accepted_edited' | 'dismissed'
      applied_prompt TEXT,
      applied_help_text TEXT,
      model TEXT NOT NULL,
      searched_at TEXT NOT NULL,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      UNIQUE (round_id, question_id)
    );

    CREATE INDEX IF NOT EXISTS idx_maturity_question_suggestions_svc ON maturity_question_suggestions(round_id, service_id);
  `);
};
