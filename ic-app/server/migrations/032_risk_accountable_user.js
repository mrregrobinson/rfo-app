// A risk's "Accountable" is one person — the family member answerable for it — not a
// free-text list of everyone who assists. Add risk_categories.accountable_user_id and
// backfill it from the old free-text `accountable` column by matching the first family
// member named. The old text column is left in place (untouched) as provenance; the app
// stops writing/showing it.
module.exports = function (db) {
  const cols = db.prepare('PRAGMA table_info(risk_categories)').all().map((c) => c.name);
  if (!cols.includes('accountable_user_id')) {
    db.exec('ALTER TABLE risk_categories ADD COLUMN accountable_user_id TEXT REFERENCES users(id)');
  }

  const users = db.prepare('SELECT id, name FROM users').all();
  const cats = db.prepare('SELECT id, accountable, accountable_user_id FROM risk_categories').all();
  const set = db.prepare('UPDATE risk_categories SET accountable_user_id = ? WHERE id = ?');
  for (const c of cats) {
    if (c.accountable_user_id) continue;
    const text = c.accountable || '';
    // earliest-appearing full name wins; fall back to a first-name match
    let best = null; let bestIdx = Infinity;
    for (const u of users) {
      const first = u.name.split(/\s+/)[0];
      for (const needle of [u.name, first]) {
        const i = text.indexOf(needle);
        if (i >= 0 && i < bestIdx) { bestIdx = i; best = u.id; }
      }
    }
    if (best) set.run(best, c.id);
  }
};
