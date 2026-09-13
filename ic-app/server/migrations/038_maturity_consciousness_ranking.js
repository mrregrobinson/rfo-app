// Capital Consciousness's `value` column (maturity_consciousness_responses.value) changes
// meaning: it used to be an independent 1-5 "how true does this feel" rating per
// statement, answered separately for each of the 7 — in practice, confusing, since most
// people rated several statements similarly, flattening the read. It is now the RANK a
// member gave that statement relative to the other six (1 = most true .. 7 = least true),
// entered as a single ranking exercise. See consciousnessOverallRollup in
// server/maturity.js and CONSCIOUSNESS_QUESTION in server/maturity-seed-data.js.
//
// No schema change is needed (same INTEGER column, just a different valid range and a
// different meaning) — this migration only clears out any responses/scores recorded
// under the OLD rating semantics so they can't be misread as ranks. Capital Consciousness
// only just shipped (a few days before this change), so there is realistically nothing to
// lose; this only touches rounds that are still draft/open, since a closed round's data is
// already frozen into its snapshot and this feature predates any closed round using it.
module.exports = function (db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maturity_consciousness_responses'").get();
  if (!table) return; // 037 hasn't run yet on this DB — nothing to clear.
  const openRounds = db.prepare("SELECT id FROM maturity_rounds WHERE status IN ('draft', 'open')").all().map((r) => r.id);
  if (!openRounds.length) return;
  const placeholders = openRounds.map(() => '?').join(',');
  const respDeleted = db.prepare(`DELETE FROM maturity_consciousness_responses WHERE round_id IN (${placeholders})`).run(...openRounds).changes;
  const scoresDeleted = db.prepare(`DELETE FROM maturity_consciousness_scores WHERE round_id IN (${placeholders})`).run(...openRounds).changes;
  if (respDeleted || scoresDeleted) {
    console.log(`038_maturity_consciousness_ranking: cleared ${respDeleted} response(s) and ${scoresDeleted} score(s) recorded under the old rating scale, across ${openRounds.length} non-closed round(s).`);
  }
};
