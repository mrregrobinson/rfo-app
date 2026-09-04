// Stores the day-of-transaction USD/EUR/GBP->CAD rate resolved for a family planning
// activity at the time it's created/edited (see POST/PUT /api/activities in
// server/index.js, using server/fx.js), instead of converting at read time with a
// hardcoded static rate. NULL for CAD activities (no conversion needed) and for any
// activity saved before this migration — public/finance.js's activityImpact falls back
// to the static ACTIVITY_FX table when fx_rate is null.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(activities)').all().map((c) => c.name);
  if (!cols.includes('fx_rate')) db.exec('ALTER TABLE activities ADD COLUMN fx_rate REAL');
};
