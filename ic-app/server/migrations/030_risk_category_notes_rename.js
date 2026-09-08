// The per-risk commentary field was originally a "Dalio Framework Note" (dalio_note).
// It's now a general "Notes" field — same content, but no longer tied to one framework
// (RFO_Risk_App_BuildSpec_v1 §5.1). Rename the column on databases that already applied
// the earlier migration 027; fresh installs get `notes` straight from 027 and this is a
// no-op for them.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(risk_categories)').all().map((c) => c.name);
  if (cols.includes('dalio_note') && !cols.includes('notes')) {
    db.exec('ALTER TABLE risk_categories RENAME COLUMN dalio_note TO notes');
  }
};
