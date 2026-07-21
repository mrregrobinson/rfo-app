module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      call_type TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd REAL NOT NULL DEFAULT 0,
      opportunity_id TEXT,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_usage_at ON api_usage(at DESC);
  `);
};
