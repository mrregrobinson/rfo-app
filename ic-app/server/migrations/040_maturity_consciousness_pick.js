// Capital Consciousness's mechanic simplifies again: rating each of the 7 statements
// independently 1-5, then ranking all 7 from most to least true, both proved more
// confusing than the thing they were meant to simplify. It is now a single pick — read
// all 7 statements and pick the ONE that best reflects the family today — the same shape
// as the maturity worksheet's own "which of these five descriptions fits best" question.
// The level IS the picked statement's level; there is nothing left to aggregate.
//
// maturity_consciousness_responses (one row per round x member x statement, holding a
// rating or a rank depending which design was live when it was written) has no further
// purpose — a single pick has nothing to aggregate FROM. Dropped outright rather than
// left around unused.
//
// maturity_consciousness_scores is UNTOUCHED: its `level`/`computed_level` columns were
// always a plain 1-7 integer regardless of how they were derived (a rating centroid, a
// ranking centroid, or now a direct pick), so every existing placement — including any
// real member's already-submitted answer — carries forward as-is under the new
// interpretation ("the statement closest to where I placed myself"). No data to lose.
module.exports = function (db) {
  db.exec('DROP TABLE IF EXISTS maturity_consciousness_responses;');
};
