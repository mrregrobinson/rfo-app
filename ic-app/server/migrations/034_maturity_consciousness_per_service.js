// Maturity Assessment — fold the consciousness lens INTO the per-service assessment
// (RFO_Maturity_App_BuildSpec_v1, "Option C").
//
// Before: a separate instrument — maturity_cc_dimensions (6 decision domains),
// maturity_cc_prompts, maturity_cc_responses (round x member x dimension) with its own
// tab and its own submit.
//
// After: one grid, two axes per service. Each member's maturity_service_scores row now
// also carries a consciousness_level (1..7 on the same scale, kept in maturity_cc_levels)
// and a one-line consciousness_note, answered in the same worksheet. The family
// centre-of-gravity and dispersion are computed from those per-service answers.
//
// This feature has no production data yet (migration 033 has not shipped), so the three
// parallel-instrument tables are dropped. maturity_cc_levels (the 7-level scale) stays.
// maturity_actions.dimension_id was declared REFERENCES maturity_cc_dimensions(id); the
// table is rebuilt without that FK (the column is kept, unreferenced) so inserts still
// work after the drop — same rebuild pattern as migration 029 for risk_actions.
module.exports = function (db) {
  const info = db.prepare('PRAGMA table_info(maturity_service_scores)').all();
  if (!info.length) return; // 033 hasn't run on this DB yet — nothing to do.
  const cols = info.map((c) => c.name);
  if (!cols.includes('consciousness_level')) {
    db.exec('ALTER TABLE maturity_service_scores ADD COLUMN consciousness_level INTEGER'); // 1..7, nullable until answered
  }
  if (!cols.includes('consciousness_note')) {
    db.exec("ALTER TABLE maturity_service_scores ADD COLUMN consciousness_note TEXT NOT NULL DEFAULT ''");
  }

  // Rebuild maturity_actions without the dimension_id -> maturity_cc_dimensions FK.
  const aInfo = db.prepare('PRAGMA table_info(maturity_actions)').all();
  const aFks = aInfo.length ? db.prepare('PRAGMA foreign_key_list(maturity_actions)').all() : [];
  if (aInfo.length && aFks.some((f) => f.table === 'maturity_cc_dimensions')) {
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec(`
      CREATE TABLE maturity_actions__new (
        id TEXT PRIMARY KEY,
        round_id TEXT REFERENCES maturity_rounds(id),
        service_id TEXT REFERENCES maturity_services(id),
        dimension_id TEXT,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        target_level REAL,
        change_dimension TEXT,
        priority TEXT NOT NULL DEFAULT 'Active',
        owner_text TEXT NOT NULL DEFAULT '',
        due_quarter TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        task_id TEXT,
        completed_at TEXT,
        archived_at TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO maturity_actions__new
        SELECT id, round_id, service_id, dimension_id, title, detail, target_level, change_dimension,
               priority, owner_text, due_quarter, status, task_id, completed_at, archived_at,
               created_by, created_at, updated_at
        FROM maturity_actions;
      DROP TABLE maturity_actions;
      ALTER TABLE maturity_actions__new RENAME TO maturity_actions;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
  }

  db.exec('DROP TABLE IF EXISTS maturity_cc_responses');
  db.exec('DROP TABLE IF EXISTS maturity_cc_prompts');
  db.exec('DROP TABLE IF EXISTS maturity_cc_dimensions');
};
