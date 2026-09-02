// Portfolio data (total value, allocation, FX, unfunded commitments, liquidity tiers) used
// to move from a hardcoded constant in public/finance.js to something an admin refreshes
// in the app itself, by uploading the latest investment report — see the
// /api/admin/portfolio/extract and /api/admin/portfolio/snapshots routes. Every upload is
// kept (never overwritten) so there's a paper trail of what the portfolio looked like at
// each report date; the app always reads the most recent one via GET /api/portfolio.
// IPS bands and fee-norm benchmarks stay out of this table on purpose — those are
// governance policy / external market data, not something a single investment report
// should be able to silently change.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      as_of TEXT NOT NULL,
      data TEXT NOT NULL,
      source_filename TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_created_at ON portfolio_snapshots(created_at DESC);
  `);
};
