// Migration 035 added the axis/consciousness columns, but could not re-seed
// maturity_questions on any database where maturity_services already had rows —
// seedMaturity() (server/seed.js) is guarded on that row count and no-ops once a service
// catalogue exists, which is true for every install made before this change (production
// included). Left alone, those installs would keep the old 4-question-per-service set
// with no consciousness-axis questions at all, so consciousnessRollup() could never
// derive anything and no service could ever be submitted.
//
// This is a NON-DESTRUCTIVE, idempotent, per-service backfill to the current
// questionsForService() shape (server/maturity-seed-data.js): it retags the existing
// "benchmark against peers" question axis:'both' by matching its prompt text, and adds
// the two axis:'consciousness' questions if they are missing — it never deletes or
// replaces a question row, so any maturity_responses already recorded against the old
// question ids stay valid. A service that already has a consciousness/both question
// (a fresh install seeded after 035) is left untouched.
module.exports = function (db) {
  const svcTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maturity_services'").get();
  if (!svcTable) return; // 033 hasn't run yet on this DB — nothing to backfill.
  const qCols = db.prepare('PRAGMA table_info(maturity_questions)').all().map((c) => c.name);
  if (!qCols.includes('axis')) return; // 035 hasn't run yet — it'll bring the column, this runs right after in the same batch.

  let seedData;
  try {
    seedData = require('../maturity-seed-data');
  } catch (err) {
    console.warn('036_maturity_backfill_consciousness_questions: could not load maturity-seed-data.js, skipping:', err.message);
    return;
  }

  const crypto = require('node:crypto');
  const services = db.prepare('SELECT id, name FROM maturity_services').all();
  const insQ = db.prepare(
    'INSERT INTO maturity_questions (id, service_id, prompt, help_text, response_kind, weight, sort_order, is_active, axis) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
  );
  let servicesTouched = 0;

  for (const s of services) {
    const already = db.prepare(
      "SELECT COUNT(*) n FROM maturity_questions WHERE service_id = ? AND axis IN ('consciousness', 'both')"
    ).get(s.id).n;
    if (already > 0) continue; // already current

    const wanted = seedData.questionsForService(s);
    let maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM maturity_questions WHERE service_id = ?').get(s.id).m || 0;
    let changed = false;

    for (const q of wanted) {
      if (q.axis !== 'consciousness' && q.axis !== 'both') continue; // pre-existing 'maturity' questions are untouched
      const match = db.prepare('SELECT id, axis FROM maturity_questions WHERE service_id = ? AND prompt = ?').get(s.id, q.prompt);
      if (match) {
        if (match.axis !== q.axis) {
          db.prepare('UPDATE maturity_questions SET axis = ? WHERE id = ?').run(q.axis, match.id);
          changed = true;
        }
      } else {
        maxSort += 1;
        insQ.run(crypto.randomUUID(), s.id, q.prompt, q.help_text || '', q.response_kind, q.weight || 1, maxSort, q.axis);
        changed = true;
      }
    }
    if (changed) servicesTouched += 1;
  }

  if (servicesTouched > 0) console.log(`036_maturity_backfill_consciousness_questions: backfilled consciousness-axis questions for ${servicesTouched} service(s).`);
};
