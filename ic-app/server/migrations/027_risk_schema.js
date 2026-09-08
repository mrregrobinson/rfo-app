// Risk Management module schema — see RFO_Risk_App_BuildSpec_v1 (§4, §5).
//
// Adds a fourth per-application role axis (users.risk_role) alongside
// dd_role/tasks_role/meetings_role (migrations 012/017), and all risk_* tables.
// Unlike the other three apps, risk_role DEFAULTs to 'viewer' — this is a shared
// register everyone with a role can read in full, but writing to it (assessments,
// events, actions, taxonomy) is opt-in. An FO admin is always also a Risk admin.
//
// Seed content (domains, 14 categories, scale, mitigations, actions, baseline
// assessments) lands in migration 028 from server/risk-seed-data.js.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('risk_role')) {
    db.exec("ALTER TABLE users ADD COLUMN risk_role TEXT NOT NULL DEFAULT 'viewer'");
  }

  // Backfill from the register's own accountability language (Cover sheet: Reg is
  // Owner/Accountable, Ross is Responsible for review and updates). Any FO admin is an
  // admin here too. Everyone else keeps the column default ('viewer').
  db.exec("UPDATE users SET risk_role = 'admin' WHERE is_fo_admin = 1");
  const setRole = db.prepare('UPDATE users SET risk_role = ? WHERE id = ?');
  setRole.run('admin', 'reg');
  setRole.run('admin', 'sd');
  setRole.run('admin', 'ross');
  setRole.run('member', 'lucas');

  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_domains (
      id TEXT PRIMARY KEY,            -- 'A'..'F'
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_categories (
      id TEXT PRIMARY KEY,           -- 'risk-01'..'risk-14' (stable, not the display number)
      domain_id TEXT NOT NULL REFERENCES risk_domains(id),
      number INTEGER NOT NULL,       -- 1..14, the register's display number
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      accountable TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',  -- general standing commentary on the risk (framework refs, context, watch-items)
      sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS risk_scale (
      kind TEXT NOT NULL,            -- 'probability' | 'impact'
      score INTEGER NOT NULL,        -- 1..4
      label TEXT NOT NULL,
      detail TEXT NOT NULL,
      PRIMARY KEY (kind, score)
    );

    CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES risk_categories(id),
      assessed_at TEXT NOT NULL,
      assessed_by TEXT NOT NULL REFERENCES users(id),
      inherent_prob INTEGER NOT NULL,
      inherent_impact INTEGER NOT NULL,
      residual_prob INTEGER NOT NULL,
      residual_impact INTEGER NOT NULL,
      status TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      next_review TEXT,
      external_probability_id TEXT REFERENCES risk_probability_lookups(id),
      supersedes_id TEXT REFERENCES risk_assessments(id),
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_risk_assessments_cat ON risk_assessments(category_id, assessed_at);

    CREATE TABLE IF NOT EXISTS risk_mitigations (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES risk_categories(id),
      text TEXT NOT NULL,
      in_place INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_actions (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES risk_categories(id),
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL,        -- 'Immediate' | 'Active' | 'Monitor'
      owner_text TEXT NOT NULL DEFAULT '',
      due_quarter TEXT,
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'in_progress' | 'done' | 'incomplete'
      -- Deliberately a plain soft reference, NOT a foreign key: deleting the promoted
      -- task in the Family Task List must be allowed to leave task_id dangling (the
      -- action then falls back to its own status — see risk.js taskInfo()). An enforced
      -- FK would make that DELETE fail. Mirrors how meeting_action_items.task_id is used.
      task_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS risk_events (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES risk_categories(id),
      occurred_on TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL,        -- 'Near miss' | 'Minor' | 'Moderate' | 'Significant' | 'Severe'
      financial_impact_cad REAL,
      status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'monitoring' | 'closed'
      response_notes TEXT NOT NULL DEFAULT '',
      logged_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_risk_events_cat ON risk_events(category_id, occurred_on);

    CREATE TABLE IF NOT EXISTS risk_probability_lookups (
      id TEXT PRIMARY KEY,
      category_id TEXT REFERENCES risk_categories(id),
      query TEXT NOT NULL,
      estimate_text TEXT NOT NULL,
      probability_low REAL,
      probability_high REAL,
      mapped_score INTEGER,
      rationale TEXT NOT NULL DEFAULT '',
      caveats TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      model TEXT NOT NULL,
      searched_by TEXT NOT NULL REFERENCES users(id),
      searched_at TEXT NOT NULL
    );
  `);
};
