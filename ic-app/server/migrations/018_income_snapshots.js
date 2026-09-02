// Mirrors portfolio_snapshots (017): the family's periodic "Yield Generating Investments
// and Projected Income" report, admin-uploaded and reviewed the same way, so recurring
// distributions can count as a liquidity source alongside the asset-tier waterfall in A4.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS income_snapshots (
      id TEXT PRIMARY KEY,
      as_of TEXT NOT NULL,
      data TEXT NOT NULL,
      source_filename TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_income_snapshots_created_at ON income_snapshots(created_at DESC);
  `);
};
