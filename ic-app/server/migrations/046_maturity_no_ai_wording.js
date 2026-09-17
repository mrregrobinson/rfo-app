// Migration 045 backfilled these two maturity_questions.help_text values with wording
// that named "AI benchmark" explicitly. Per a follow-up request, the app no longer
// mentions "AI" anywhere in user-facing text at all (not just a generic term in place of
// a vendor name) — this updates the same two rows to the new wording.
//
// Non-destructive: matched by 045's exact wording, so a question an admin has since
// edited directly (PUT /api/maturity/questions/:qid) is left untouched.
module.exports = function (db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maturity_questions'").get();
  if (!table) return; // 033 hasn't run yet on this DB — nothing to backfill.

  let changed = 0;

  changed += db.prepare(
    `UPDATE maturity_questions SET help_text = ? WHERE help_text = ?`
  ).run(
    'Pick the single description that fits best overall, even if some details differ. "Leading Practice" describes a habit of comparing and improving — it does not require you to have hired outside benchmarking yourselves; this assessment\'s own benchmark supplies that external comparison.',
    'Pick the single description that fits best overall, even if some details differ. "Leading Practice" describes a habit of comparing and improving — it does not require you to have hired outside benchmarking yourselves; this assessment\'s own AI benchmark supplies that external comparison.'
  ).changes;

  changed += db.prepare(
    `UPDATE maturity_questions SET help_text = ? WHERE help_text = ?`
  ).run(
    'This is about the habit of comparing and improving, not about having run your own external benchmarking study — that\'s what this tool\'s own benchmark is for.',
    'This is about the habit of comparing and improving, not about having run your own external benchmarking study — that\'s what this tool\'s AI benchmark is for.'
  ).changes;

  if (changed > 0) console.log(`046_maturity_no_ai_wording: updated help_text on ${changed} question(s).`);
};
