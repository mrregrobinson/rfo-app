// Historical-data support for the Risk Management module (RFO_Risk_App_BuildSpec_v1 §11):
//
//  - risk_actions   gains completed_at + archived_at. "Delete" now archives (soft), so
//    progress reporting ("N actions closed / archived since <date>") stays possible.
//  - risk_mitigations gains added_at + removed_at, so a report run for a past date can
//    reconstruct which controls were in place then.
//  - risk_review_snapshots stores a full frozen copy of the register whenever a review
//    is finalised — the "pull up the Q2 report, verbatim" capability. payload is the
//    same JSON shape buildReportModel() assembles.
module.exports = function (db) {
  const acols = db.prepare('PRAGMA table_info(risk_actions)').all().map((c) => c.name);
  if (!acols.includes('completed_at')) db.exec('ALTER TABLE risk_actions ADD COLUMN completed_at TEXT');
  if (!acols.includes('archived_at')) db.exec('ALTER TABLE risk_actions ADD COLUMN archived_at TEXT');
  // Best-effort backfill: treat an already-"done" action as completed when it was last
  // touched. Not exact, but better than null for actions closed before this migration.
  db.exec("UPDATE risk_actions SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL");

  const mcols = db.prepare('PRAGMA table_info(risk_mitigations)').all().map((c) => c.name);
  if (!mcols.includes('added_at')) db.exec('ALTER TABLE risk_mitigations ADD COLUMN added_at TEXT');
  if (!mcols.includes('removed_at')) db.exec('ALTER TABLE risk_mitigations ADD COLUMN removed_at TEXT');
  db.exec('UPDATE risk_mitigations SET added_at = created_at WHERE added_at IS NULL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS risk_review_snapshots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      taken_at TEXT NOT NULL,
      taken_by TEXT NOT NULL REFERENCES users(id),
      residual_exposure INTEGER,
      inherent_exposure INTEGER,
      open_actions INTEGER,
      category_count INTEGER,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_risk_snapshots_taken ON risk_review_snapshots(taken_at);
  `);
};
