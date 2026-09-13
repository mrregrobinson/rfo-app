// Disconnects Capital Consciousness from the per-service maturity worksheet again.
// See RFO_Maturity_App_BuildSpec_v1 §5.8 (superseding the "Option C" per-service design
// from migrations 034-036): asking the same two plain-language questions on every one of
// 16 services was not a good measurement — it's the same shallow read repeated, not a
// real instrument. Capital Consciousness goes back to being its own thing, assessed ONCE
// per round (not per service), but — unlike the very first version — the level is still
// DERIVED from a short questionnaire, not a bare self-placement on the named 7-level arc.
//
// The questionnaire follows the white paper's own logic (Appendix I: "the level at which
// you find the most 'currently true' responses is likely your dominant level"): one plain
// statement per level, rated 1-5 for how true it feels; the overall level is the
// weighted centroid across all seven ratings, not a single pick.
//
// This migration:
//  1. Removes the per-service consciousness questions added in 035 (data cleanup; a
//     "both"-tagged question — e.g. "we benchmark against peers" — reverts to a plain
//     maturity question, nothing is deleted that a member might have answered as part of
//     their maturity score).
//  2. Drops the now-dead per-service consciousness columns/axis column — there is no
//     production data to lose (the feature has been live only a few days; the family
//     hadn't opened a real round on it yet), and leaving unused columns around the day
//     after ripping out the feature they served would just be confusing.
//  3. Creates the new standalone tables: maturity_consciousness_statements (the 7
//     statements, admin-editable), maturity_consciousness_responses (one row per round x
//     member x statement), maturity_consciousness_scores (one row per round x member —
//     the derived level, mirroring maturity_service_scores' level/computed_level/method
//     shape, at round grain instead of service grain).
module.exports = function (db) {
  const qCols = db.prepare('PRAGMA table_info(maturity_questions)').all().map((c) => c.name);
  if (qCols.includes('axis')) {
    db.exec("DELETE FROM maturity_questions WHERE axis = 'consciousness'");
    db.exec("UPDATE maturity_questions SET axis = 'maturity' WHERE axis = 'both'");
    db.exec('ALTER TABLE maturity_questions DROP COLUMN axis');
  }

  const sCols = db.prepare('PRAGMA table_info(maturity_service_scores)').all().map((c) => c.name);
  for (const col of ['consciousness_level', 'computed_consciousness_level', 'consciousness_method', 'consciousness_note']) {
    if (sCols.includes(col)) db.exec(`ALTER TABLE maturity_service_scores DROP COLUMN ${col}`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS maturity_consciousness_statements (
      level INTEGER PRIMARY KEY,        -- 1..7, one statement per named level
      statement TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_consciousness_responses (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      level INTEGER NOT NULL,          -- which of the 7 statements this answers
      value INTEGER NOT NULL,          -- 1..5, how true it currently feels
      updated_at TEXT NOT NULL,
      UNIQUE (round_id, user_id, level)
    );

    CREATE TABLE IF NOT EXISTS maturity_consciousness_scores (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      level REAL,                      -- 1..7, the derived (or overridden) placement
      computed_level REAL,             -- what the questionnaire produced, kept even when overridden
      method TEXT NOT NULL DEFAULT 'questionnaire',  -- 'questionnaire' | 'direct'
      note TEXT NOT NULL DEFAULT '',
      submitted INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT,
      UNIQUE (round_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_maturity_cc_responses_round ON maturity_consciousness_responses(round_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_maturity_cc_scores_round ON maturity_consciousness_scores(round_id);
  `);
};
