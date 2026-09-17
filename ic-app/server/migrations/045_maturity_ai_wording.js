// Backfills two maturity_questions.help_text values from server/maturity-seed-data.js's
// questionsForService() that were never actually reached by any install: ensureSeeded()
// only inserts these rows once, and the seed source had already drifted from what got
// seeded — the level-pick question's help_text was seeded short ("Pick the single
// description...") while the source has long since carried a second explanatory sentence,
// and the peer-comparison question's help_text was seeded empty while the source has
// real content. Found while converting the app's "Claude" wording to generic "AI" wording
// — the seed source's Claude mention here had never reached any real database, so this
// backfill both delivers the missing explanatory text and lands it already generic.
//
// Non-destructive: matched by exact current value, so a question an admin has since
// edited directly (PUT /api/maturity/questions/:qid) is left untouched.
module.exports = function (db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maturity_questions'").get();
  if (!table) return; // 033 hasn't run yet on this DB — nothing to backfill.

  let changed = 0;

  changed += db.prepare(
    `UPDATE maturity_questions SET help_text = ?
     WHERE response_kind = 'level_pick' AND help_text = 'Pick the single description that fits best overall, even if some details differ.'`
  ).run(
    'Pick the single description that fits best overall, even if some details differ. "Leading Practice" describes a habit of comparing and improving — it does not require you to have hired outside benchmarking yourselves; this assessment\'s own AI benchmark supplies that external comparison.'
  ).changes;

  // Matched by position (sort_order 4, the peer-comparison question), not prompt text —
  // the seeded prompt itself ("We benchmark X against peer family offices...") has drifted
  // from the current seed source's wording ("We deliberately compare how we approach
  // X..."), a separate, pre-existing divergence between server/maturity-seed-data.js and
  // what ensureSeeded() actually wrote. Only help_text is touched here; the prompt wording
  // is a real content change (what members are actually asked) and is left for a
  // deliberate decision rather than folded into this cleanup.
  changed += db.prepare(
    `UPDATE maturity_questions SET help_text = ?
     WHERE sort_order = 4 AND response_kind = 'scale_1_5' AND (help_text IS NULL OR help_text = '')`
  ).run(
    'This is about the habit of comparing and improving, not about having run your own external benchmarking study — that\'s what this tool\'s AI benchmark is for.'
  ).changes;

  if (changed > 0) console.log(`045_maturity_ai_wording: backfilled help_text on ${changed} question(s).`);
};
