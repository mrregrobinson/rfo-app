module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      initials TEXT NOT NULL,
      color TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      setup_code_hash TEXT,
      password_hash TEXT,
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      commitment REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      deadline TEXT,
      additional_context TEXT DEFAULT '',
      notify_lucas INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      pq_summary TEXT DEFAULT '',
      pq_data TEXT NOT NULL DEFAULT '{}',
      research TEXT NOT NULL DEFAULT '{}',
      report TEXT,
      decision TEXT
    );

    CREATE TABLE IF NOT EXISTS responses (
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      responses TEXT NOT NULL DEFAULT '{}',
      recommendation TEXT,
      overall TEXT DEFAULT '',
      follow_up TEXT NOT NULL DEFAULT '[]',
      submitted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (opportunity_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CAD',
      decrease_class TEXT,
      increase_class TEXT,
      impact TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Considering',
      timing TEXT NOT NULL DEFAULT 'Uncertain',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};
