// Shared cache for the Bank of Canada Valet API's daily CAD exchange rates (see
// server/fx.js) — used by both the Household Expenditure app and the Due Diligence
// app's currency conversions (activities, unfunded commitments, liquidity tiers, income
// positions). Caching means a historical figure never silently changes if the lookup
// logic changes later, and repeated lookups for the same date don't re-hit the network.
// rate_date can differ from requested_date over a weekend/holiday, when the most recent
// prior business day's published rate is used instead — kept distinct so that fallback
// is auditable rather than silent.
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      requested_date TEXT NOT NULL,
      pair TEXT NOT NULL,
      rate REAL NOT NULL,
      rate_date TEXT NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (requested_date, pair)
    );
  `);
};
