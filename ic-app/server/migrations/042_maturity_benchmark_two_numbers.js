// The Claude benchmark used to return one external number per service — ambiguous about
// whether it meant "where a comparable family office is" or was implicitly anchored to
// the family's own self-score. Splits it into two explicit, independently-derived reads
// (§7.1):
//   - peer_level (renamed from benchmark_level) / peer_rationale (renamed from rationale):
//     where genuinely comparable family offices typically operate this service, from web
//     research — unchanged in spirit from the original single-number benchmark.
//   - assessed_level / assessed_rationale (new): Claude's OWN independent read of where
//     THIS family likely sits, reasoned from the family's own level descriptors and
//     context rather than simply echoing their self-score. Nullable — existing benchmark
//     rows predate this second number and have nothing to backfill it with; a new
//     "Run Claude benchmark" produces both going forward.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(maturity_benchmarks)').all().map((c) => c.name);
  if (cols.includes('benchmark_level') && !cols.includes('peer_level')) {
    db.exec('ALTER TABLE maturity_benchmarks RENAME COLUMN benchmark_level TO peer_level');
  }
  if (cols.includes('rationale') && !cols.includes('peer_rationale')) {
    db.exec('ALTER TABLE maturity_benchmarks RENAME COLUMN rationale TO peer_rationale');
  }
  const colsNow = db.prepare('PRAGMA table_info(maturity_benchmarks)').all().map((c) => c.name);
  if (!colsNow.includes('assessed_level')) {
    db.exec('ALTER TABLE maturity_benchmarks ADD COLUMN assessed_level REAL');
  }
  if (!colsNow.includes('assessed_rationale')) {
    db.exec("ALTER TABLE maturity_benchmarks ADD COLUMN assessed_rationale TEXT NOT NULL DEFAULT ''");
  }
};
