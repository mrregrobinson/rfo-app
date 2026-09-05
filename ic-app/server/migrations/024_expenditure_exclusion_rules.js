// Replaces the hardcoded transfer/income detection patterns in
// server/expenditure.js's isTransferOrIncome with a data-driven, per-ledger,
// user-manageable rules table — see RFO_Expenditure_App_BuildSpec_v1.md and
// server/expenditure-defaults.js for the seeded starting set.
const { DEFAULT_EXCLUSION_RULES } = require('../expenditure-defaults');

module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenditure_exclusion_rules (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES expenditure_ledgers(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'substring',
      direction TEXT NOT NULL DEFAULT 'any',
      account_type TEXT NOT NULL DEFAULT 'any',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_exclusion_rules_ledger ON expenditure_exclusion_rules(ledger_id);
  `);

  // Backfill: seed the default exclusion rules for every ledger that already exists as
  // of this migration running — i.e. this household's real ledger, created by an
  // earlier migration/seed run long before this feature existed. A ledger created AFTER
  // this migration (a fresh install, or a future Ross/Lucas ledger) is seeded at
  // creation time instead — see seed.js — since migrations always run once, at boot,
  // before seed.js ever gets a chance to create a ledger on a brand-new database.
  const ledgers = db.prepare('SELECT id FROM expenditure_ledgers').all();
  const now = new Date().toISOString();
  for (const ledger of ledgers) {
    const alreadySeeded = db.prepare('SELECT COUNT(*) AS n FROM expenditure_exclusion_rules WHERE ledger_id = ?').get(ledger.id).n;
    if (alreadySeeded > 0) continue;
    DEFAULT_EXCLUSION_RULES.forEach((rule, i) => {
      db.prepare(
        `INSERT INTO expenditure_exclusion_rules (id, ledger_id, pattern, match_type, direction, account_type, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(`${ledger.id}-excl-${i}`, ledger.id, rule.pattern, rule.matchType, rule.direction, rule.accountType, now);
    });
  }
};
