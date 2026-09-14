// Adds an explicit improvement recommendation to the Claude benchmark (§7.1). Until now
// benchmarkMaturityService only returned a benchmark level, a rationale for how it got
// there, and a generic "what would move up" list — it never actually said whether
// pursuing that improvement was worth the family's time given their size and complexity,
// or how urgently. This adds that judgment as its own field, using the same priority
// vocabulary as maturity_actions (Immediate / Active / Monitor) plus a 'Maintain' option
// for "this level is already appropriate for a family office this size — don't invest
// further here right now".
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(maturity_benchmarks)').all().map((c) => c.name);
  if (!cols.includes('recommended_priority')) {
    db.exec("ALTER TABLE maturity_benchmarks ADD COLUMN recommended_priority TEXT NOT NULL DEFAULT 'Monitor'");
  }
  if (!cols.includes('recommendation')) {
    db.exec("ALTER TABLE maturity_benchmarks ADD COLUMN recommendation TEXT NOT NULL DEFAULT ''");
  }
};
