// Maturity Assessment module schema — see RFO_Maturity_App_BuildSpec_v1 (§4, §5).
//
// Adds a fifth per-application role axis (users.maturity_role) alongside
// dd_role/tasks_role/meetings_role/risk_role (migrations 012/017/027), and all
// maturity_* tables. Like Tasks/Meetings (and unlike Risk), maturity_role DEFAULTs to
// 'member' — every family member is expected to complete an assessment. An FO admin is
// always also a Maturity admin.
//
// Seed content (5 groups, 16 services, the 5 level labels, the 80 level descriptors, the
// starter question set, the Capital Consciousness ladder/dimensions/prompts, and the
// closed "2026 Baseline (Appendix B)" reference round) is applied by server/seed.js's
// ensureSeeded() from server/maturity-seed-data.js — NOT here. Migrations run before any
// user exists, and the reference round's member scores need a real user to attribute to.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('maturity_role')) {
    db.exec("ALTER TABLE users ADD COLUMN maturity_role TEXT NOT NULL DEFAULT 'member'");
  }

  // Any FO admin is a Maturity admin too. Reg and Sheri-Dawn hold FO admin; Ross and
  // Lucas keep the column default ('member' — self-assess only).
  db.exec("UPDATE users SET maturity_role = 'admin' WHERE is_fo_admin = 1");
  const setRole = db.prepare('UPDATE users SET maturity_role = ? WHERE id = ?');
  setRole.run('admin', 'reg');
  setRole.run('admin', 'sd');
  setRole.run('member', 'ross');
  setRole.run('member', 'lucas');

  db.exec(`
    CREATE TABLE IF NOT EXISTS maturity_service_groups (
      id TEXT PRIMARY KEY,               -- 'strategic-services', 'people', ...
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_services (
      id TEXT PRIMARY KEY,              -- 'svc-01'..'svc-16' (stable, not the display number)
      group_id TEXT NOT NULL REFERENCES maturity_service_groups(id),
      number INTEGER NOT NULL,          -- 1..16, display order
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS maturity_level_labels (
      level INTEGER PRIMARY KEY,        -- 1..5
      name TEXT NOT NULL,               -- 'Ad Hoc', 'Emerging', 'Established', 'Institutionalized', 'Leading Practice'
      blurb TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS maturity_level_descriptors (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      level INTEGER NOT NULL,           -- 1..5
      text TEXT NOT NULL,               -- editable "how this service operates at this level" (Appendix B cols C..G)
      updated_at TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id),
      UNIQUE (service_id, level)
    );

    CREATE TABLE IF NOT EXISTS maturity_descriptor_suggestions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      level INTEGER NOT NULL,           -- 1..5
      current_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'accepted_edited' | 'dismissed'
      applied_text TEXT,
      model TEXT NOT NULL,
      searched_at TEXT NOT NULL,
      reviewed_by TEXT REFERENCES users(id),
      reviewed_at TEXT,
      UNIQUE (round_id, service_id, level)
    );

    CREATE TABLE IF NOT EXISTS maturity_questions (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      prompt TEXT NOT NULL,
      help_text TEXT NOT NULL DEFAULT '',
      response_kind TEXT NOT NULL,      -- 'scale_1_5' | 'level_pick'
      weight REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS maturity_rounds (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      status TEXT NOT NULL,             -- 'draft' | 'open' | 'closed'
      period_start TEXT,
      period_end TEXT,
      opened_at TEXT,
      opened_by TEXT REFERENCES users(id),
      closed_at TEXT,
      closed_by TEXT REFERENCES users(id),
      notes TEXT NOT NULL DEFAULT '',
      ladder_json TEXT NOT NULL DEFAULT '{}',  -- frozen {services, levelLabels, descriptors, questions} at the draft->open transition
      carried_from TEXT REFERENCES maturity_rounds(id),
      is_anchor INTEGER NOT NULL DEFAULT 0,     -- exactly one closed round: the baseline all comparisons default to
      synthesis_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_responses (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      question_id TEXT NOT NULL REFERENCES maturity_questions(id),
      value REAL NOT NULL,             -- 1..5
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE (round_id, service_id, user_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS maturity_service_scores (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      level REAL NOT NULL,             -- 1..5, half-steps allowed
      computed_level REAL,             -- what the questionnaire produced, kept even when overridden
      method TEXT NOT NULL,            -- 'questionnaire' | 'direct'
      rationale TEXT NOT NULL DEFAULT '',
      submitted INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT,
      UNIQUE (round_id, service_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS maturity_benchmarks (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      service_id TEXT NOT NULL REFERENCES maturity_services(id),
      benchmark_level REAL NOT NULL,   -- 1..5, half-steps allowed
      rationale TEXT NOT NULL,
      what_would_move_up TEXT NOT NULL DEFAULT '[]',
      sources TEXT NOT NULL DEFAULT '[]',
      caveats TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      searched_by TEXT NOT NULL REFERENCES users(id),
      searched_at TEXT NOT NULL,
      UNIQUE (round_id, service_id)
    );

    CREATE TABLE IF NOT EXISTS maturity_actions (
      id TEXT PRIMARY KEY,
      round_id TEXT REFERENCES maturity_rounds(id),
      service_id TEXT REFERENCES maturity_services(id),
      dimension_id TEXT REFERENCES maturity_cc_dimensions(id),
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      target_level REAL,
      change_dimension TEXT,           -- 'Physical'|'Intellectual'|'Emotional'|'Soulful' (CC actions)
      priority TEXT NOT NULL DEFAULT 'Active',  -- 'Immediate' | 'Active' | 'Monitor'
      owner_text TEXT NOT NULL DEFAULT '',
      due_quarter TEXT,
      status TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'in_progress' | 'done'
      -- Plain soft reference, NOT a foreign key — deleting the promoted task must be
      -- allowed to leave task_id dangling (mirrors risk_actions.task_id / migration 029).
      task_id TEXT,
      completed_at TEXT,
      archived_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_round_snapshots (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      taken_at TEXT NOT NULL,
      taken_by TEXT REFERENCES users(id),
      label TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_cc_levels (
      level INTEGER PRIMARY KEY,        -- 1..7
      name TEXT NOT NULL,               -- 'Instinctive' .. 'Transcendent'
      tagline TEXT NOT NULL,            -- 'Capital as survival' .. 'Capital as freedom'
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_cc_dimensions (
      id TEXT PRIMARY KEY,             -- 'overall','investment','tax-structure','estate-succession','philanthropy-impact','advisory'
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      service_ids TEXT NOT NULL DEFAULT '[]'   -- JSON: maturity_services cross-referenced in the synthesis (§8.3)
    );

    CREATE TABLE IF NOT EXISTS maturity_cc_prompts (
      id TEXT PRIMARY KEY,
      dimension_id TEXT NOT NULL REFERENCES maturity_cc_dimensions(id),
      prompt TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maturity_cc_responses (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES maturity_rounds(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      dimension_id TEXT NOT NULL REFERENCES maturity_cc_dimensions(id),
      level INTEGER NOT NULL,          -- 1..7
      reflection TEXT NOT NULL DEFAULT '',
      submitted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (round_id, user_id, dimension_id)
    );

    CREATE INDEX IF NOT EXISTS idx_maturity_scores_round ON maturity_service_scores(round_id, service_id);
    CREATE INDEX IF NOT EXISTS idx_maturity_responses_round ON maturity_responses(round_id, service_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_maturity_benchmarks_round ON maturity_benchmarks(round_id, service_id);
    CREATE INDEX IF NOT EXISTS idx_maturity_cc_responses_round ON maturity_cc_responses(round_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_maturity_descriptors_svc ON maturity_level_descriptors(service_id, level);
  `);
};
