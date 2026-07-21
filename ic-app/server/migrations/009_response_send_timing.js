// Lets an initiator control when each family member individually gains access to a
// published opportunity, instead of publishing making it visible to everyone at once.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(responses)').all().map((c) => c.name);
  if (!cols.includes('sent_at')) {
    db.exec('ALTER TABLE responses ADD COLUMN sent_at TEXT');
    // Opportunities that were already published under the old all-at-once model were
    // already visible to the whole family — backfill sent_at for those so this change
    // doesn't retroactively hide anything anyone could already see.
    db.exec(`
      UPDATE responses SET sent_at = (
        SELECT o.created_at FROM opportunities o WHERE o.id = responses.opportunity_id
      )
      WHERE opportunity_id IN (SELECT id FROM opportunities WHERE status != 'draft')
    `);
  }
};
