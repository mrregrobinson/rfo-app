// The starter exclusion rules seeded for every expenditure ledger — exactly the patterns
// that used to be hardcoded in server/expenditure.js's isTransferOrIncome before it
// became data-driven (see migration 024 and the "manage exclusions" feature). Exported
// from its own module so both the migration (backfills a ledger that already existed
// before this feature did) and seed.js (seeds a brand-new ledger) share one canonical
// definition instead of two copies that could drift apart — the exact bug already hit
// once with the starter category list (see migration 023's history).
//
// matchType 'regex' is used where the original hardcoded pattern relied on anchoring or
// a word boundary (e.g. "^account transfer" must match at the START of the description,
// not just contain it anywhere) — preserved exactly rather than approximated with a
// plain substring, so this migration changes nothing about what gets excluded on day
// one. direction 'negative' means "only when money is coming IN" (so an outgoing
// payment that happens to mention "payroll" by coincidence isn't swept up as income);
// accountType 'credit_card' scopes the payment-detection rule to the card only, since
// "payment" on chequing/e-Transfer descriptions means something else entirely.
const DEFAULT_EXCLUSION_RULES = [
  { pattern: '^online banking transfer', matchType: 'regex', direction: 'any', accountType: 'any' },
  { pattern: '^online banking payment', matchType: 'regex', direction: 'any', accountType: 'any' },
  { pattern: '^account transfer', matchType: 'regex', direction: 'any', accountType: 'any' },
  { pattern: '^funds transfer', matchType: 'regex', direction: 'any', accountType: 'any' },
  { pattern: '^investment ', matchType: 'regex', direction: 'any', accountType: 'any' },
  { pattern: '^deposit interest', matchType: 'regex', direction: 'negative', accountType: 'any' },
  { pattern: '^interest ', matchType: 'regex', direction: 'negative', accountType: 'any' },
  { pattern: 'payroll', matchType: 'substring', direction: 'negative', accountType: 'any' },
  { pattern: '\\bsalary\\b', matchType: 'regex', direction: 'negative', accountType: 'any' },
  { pattern: '^direct deposit', matchType: 'regex', direction: 'negative', accountType: 'any' },
  { pattern: '\\bdividend\\b', matchType: 'regex', direction: 'negative', accountType: 'any' },
  { pattern: 'payment', matchType: 'substring', direction: 'negative', accountType: 'credit_card' },
];

module.exports = { DEFAULT_EXCLUSION_RULES };
