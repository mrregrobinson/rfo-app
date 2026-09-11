// Maturity Assessment — derive the consciousness level from questions, not a bare
// 1-7 self-placement. See RFO_Maturity_App_BuildSpec_v1 §5.3/§5.8.
//
// Before: a member picked their consciousness level directly off the named 7-level arc
// (Instinctive..Transcendent) — which assumes they've read and understood the framework.
//
// After: every service's question set carries one or two consciousness-axis questions —
// plain statements, answered the same 1-5 way as the maturity questions, integrated into
// the same worksheet (server/maturity-seed-data.js questionsForService()). A member can
// still override the computed level directly; that override is now tracked with its own
// method column, parallel to how a maturity-level override works.
//
// maturity_questions.axis marks which rollup(s) a question feeds: 'maturity' (default,
// existing questions), 'consciousness', or 'both' (a maturity question whose answer is
// also a meaningful consciousness signal, e.g. "we benchmark against peers and improve
// deliberately").
module.exports = function (db) {
  const qCols = db.prepare('PRAGMA table_info(maturity_questions)').all();
  if (!qCols.length) return; // 033 hasn't run yet on this DB — nothing to do.
  if (!qCols.some((c) => c.name === 'axis')) {
    db.exec("ALTER TABLE maturity_questions ADD COLUMN axis TEXT NOT NULL DEFAULT 'maturity'");
  }

  const sCols = db.prepare('PRAGMA table_info(maturity_service_scores)').all().map((c) => c.name);
  if (!sCols.includes('computed_consciousness_level')) {
    db.exec('ALTER TABLE maturity_service_scores ADD COLUMN computed_consciousness_level REAL');
  }
  if (!sCols.includes('consciousness_method')) {
    db.exec("ALTER TABLE maturity_service_scores ADD COLUMN consciousness_method TEXT NOT NULL DEFAULT 'questionnaire'");
  }
};
