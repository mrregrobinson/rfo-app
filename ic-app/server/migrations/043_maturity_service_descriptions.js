// Backfills maturity_services.description for installs where the service catalogue was
// already seeded — server/seed.js's ensureSeeded() guards on maturity_services already
// having rows and never re-runs the SERVICES insert, so a content-only change to the
// SERVICES array in server/maturity-seed-data.js (this one: adding real evidence-grounded
// `description` text per service, previously always empty on every install) needs an
// explicit backfill to reach production. Same class of gap as migration 036's backfill.
//
// Non-destructive: only fills a service's description where it's currently empty, so an
// admin who already typed their own description (via PUT /api/maturity/services/:id)
// keeps it untouched. Matched by service id, not name/position.
module.exports = function (db) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='maturity_services'").get();
  if (!table) return; // 033 hasn't run yet on this DB — nothing to backfill.

  let seedData;
  try {
    seedData = require('../maturity-seed-data');
  } catch (err) {
    console.warn('043_maturity_service_descriptions: could not load maturity-seed-data.js, skipping:', err.message);
    return;
  }

  const upd = db.prepare('UPDATE maturity_services SET description = ? WHERE id = ? AND (description IS NULL OR description = ?)');
  let updated = 0;
  for (const s of seedData.SERVICES || []) {
    if (!s.description) continue;
    const info = upd.run(s.description, s.id, '');
    if (info.changes > 0) updated += 1;
  }
  if (updated > 0) console.log(`043_maturity_service_descriptions: backfilled description for ${updated} service(s).`);
};
