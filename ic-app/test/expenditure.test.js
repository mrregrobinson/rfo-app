const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isTransferOrIncome, detectAccountFromFilename, payeeLikePattern, wildcardToRegExp } = require('../server/expenditure');
const { DEFAULT_EXCLUSION_RULES } = require('../server/expenditure-defaults');

// isTransferOrIncome is now data-driven (see the "manage exclusions" feature) — it takes
// whatever rules a ledger actually has as its 4th argument, rather than consulting
// hardcoded module constants. These tests exercise it against the same canonical
// default rule set every real ledger is seeded with (server/expenditure-defaults.js),
// converted to the snake_case shape a real database row has, so a change to the
// defaults is caught here too rather than the test silently testing a stale copy.
const defaultRules = DEFAULT_EXCLUSION_RULES.map((r) => ({
  pattern: r.pattern, match_type: r.matchType, direction: r.direction, account_type: r.accountType,
}));

describe('isTransferOrIncome', () => {
  test('an internal transfer between the household\'s own accounts is excluded', () => {
    assert.equal(isTransferOrIncome('Online Banking transfer - 2591', 'chequing', 32, defaultRules), true);
    assert.equal(isTransferOrIncome('Account transfer RR KEYS CORP', 'chequing', 1000, defaultRules), true);
    assert.equal(isTransferOrIncome('Online Banking payment - 1427', 'chequing', 1918.86, defaultRules), true);
  });

  test('capital movements (investments, funds transfers) are excluded', () => {
    assert.equal(isTransferOrIncome('Investment TREZ CAPITAL', 'chequing', 15000, defaultRules), true);
    assert.equal(isTransferOrIncome('Funds transfer fee TT ICAPITAL BLU', 'chequing', 3362.88, defaultRules), true);
  });

  test('interest (income) is excluded — out of scope for this app, not just "a transfer"', () => {
    assert.equal(isTransferOrIncome('Deposit interest', 'chequing', -538.73, defaultRules), true);
    assert.equal(isTransferOrIncome('Interest WMILP Operating', 'chequing', -0.24, defaultRules), true);
  });

  test('payroll/salary/dividend deposits are excluded as income, not just interest', () => {
    assert.equal(isTransferOrIncome('PAYROLL DEP ACME CORP', 'chequing', -3200, defaultRules), true);
    assert.equal(isTransferOrIncome('Direct Deposit Payroll', 'chequing', -2900, defaultRules), true);
    assert.equal(isTransferOrIncome('ACME CORP SALARY', 'chequing', -3200, defaultRules), true);
    assert.equal(isTransferOrIncome('Dividend RBC Direct Investing', 'chequing', -412.50, defaultRules), true);
  });

  test('a word like "payroll" in an outgoing payment is NOT excluded — the income patterns only apply to money coming in', () => {
    assert.equal(isTransferOrIncome('ADP PAYROLL SERVICES FEE', 'chequing', 45, defaultRules), false);
  });

  test('a genuine recurring household cost is NOT excluded, even if it sounds transfer-adjacent', () => {
    assert.equal(isTransferOrIncome('Property Tax CityOf Waterloo', 'chequing', 1900, defaultRules), false);
  });

  test('an e-Transfer to a real vendor for real services is NOT excluded — only internal-transfer wording is', () => {
    assert.equal(isTransferOrIncome('e-Transfer sent Red Bear Landscaping', 'chequing', 231, defaultRules), false);
    assert.equal(isTransferOrIncome('e-Transfer sent Dobson Yard Care', 'chequing', 500, defaultRules), false);
    assert.equal(isTransferOrIncome('e-Transfer sent Jodi Kingdon V7FC9L', 'chequing', 17, defaultRules), false);
  });

  test('a credit card payment (paying down the card from chequing) is excluded — it is the transfer side of spending already itemized on the card', () => {
    assert.equal(isTransferOrIncome('PAYMENT - THANK YOU', 'credit_card', -15000, defaultRules), true);
    assert.equal(isTransferOrIncome('Payment received', 'credit_card', -10000, defaultRules), true);
  });

  test('a refund/credit for a returned purchase on the card is NOT excluded — it is real (negative) spending, not a transfer', () => {
    assert.equal(isTransferOrIncome('MICROSOFT#G173232359 HALIFAX NS', 'credit_card', -26.87, defaultRules), false);
  });

  test('an ordinary purchase is never excluded', () => {
    assert.equal(isTransferOrIncome('CLEAR LAKE GOLF COURSE WASAGAMING MB', 'credit_card', 111.68, defaultRules), false);
    assert.equal(isTransferOrIncome('HERITAGE COOP ERIC GROC ERICKSON MB', 'credit_card', 76.81, defaultRules), false);
  });

  test('with no rules at all (a ledger that removed every exclusion rule), nothing is excluded', () => {
    assert.equal(isTransferOrIncome('Online Banking transfer - 2591', 'chequing', 32, []), false);
    assert.equal(isTransferOrIncome('Online Banking transfer - 2591', 'chequing', 32, undefined), false);
  });

  test('a household-added custom rule (e.g. excluding a specific recurring internal payee) works the same way as a default one', () => {
    const customRule = { pattern: 'RENT TO OWN CORP', match_type: 'substring', direction: 'any', account_type: 'any' };
    assert.equal(isTransferOrIncome('e-Transfer sent RENT TO OWN CORP', 'chequing', 500, [customRule]), true);
    assert.equal(isTransferOrIncome('e-Transfer sent Some Other Payee', 'chequing', 500, [customRule]), false);
  });
});

describe('detectAccountFromFilename', () => {
  test('recognizes the CAD chequing statement pattern', () => {
    const acc = detectAccountFromFilename('R&S CAD Chequing 5000344 Statement-0344 2026-08-21.pdf');
    assert.equal(acc.accountType, 'chequing');
    assert.equal(acc.currency, 'CAD');
    assert.equal(acc.externalIdentifier, '0344');
  });

  test('recognizes the USD chequing statement pattern', () => {
    const acc = detectAccountFromFilename('R&S USD Chequing 4500435 Statement-0435 2026-08-21.pdf');
    assert.equal(acc.accountType, 'chequing');
    assert.equal(acc.currency, 'USD');
    assert.equal(acc.externalIdentifier, '0435');
  });

  test('recognizes the Visa Privilege credit card statement pattern', () => {
    const acc = detectAccountFromFilename('4646-9236-0080-8369 (R&S Priv) Statement-8369 2026-08-24.pdf');
    assert.equal(acc.accountType, 'credit_card');
    assert.equal(acc.currency, 'CAD');
    assert.equal(acc.externalIdentifier, '8369');
  });

  test('a duplicate-suffixed filename (" (1)") still matches', () => {
    const acc = detectAccountFromFilename('R%26S CAD Chequing 5000344 Statement-0344 2026-07-21 (1).pdf');
    assert.equal(acc.accountType, 'chequing');
    assert.equal(acc.currency, 'CAD');
  });

  test('an unrecognized filename returns null rather than guessing', () => {
    assert.equal(detectAccountFromFilename('some-other-bank-statement.pdf'), null);
    assert.equal(detectAccountFromFilename(''), null);
  });
});

describe('payeeLikePattern', () => {
  test('plain text with no wildcard becomes a substring search, same as before wildcards existed', () => {
    assert.equal(payeeLikePattern('Costco'), '%Costco%');
  });

  test('* matches any run of characters', () => {
    assert.equal(payeeLikePattern('COST*'), 'COST%');
    assert.equal(payeeLikePattern('*COOP*'), '%COOP%');
  });

  test('? matches exactly one character', () => {
    assert.equal(payeeLikePattern('SQ ?THE BARN'), 'SQ _THE BARN');
  });

  test('a literal %, _, or \\ in the search text is escaped, not treated as a SQL wildcard', () => {
    assert.equal(payeeLikePattern('50% OFF'), '%50\\% OFF%');
    assert.equal(payeeLikePattern('A_B'), '%A\\_B%');
  });

  test('escaping and user wildcards combine correctly in the same search', () => {
    assert.equal(payeeLikePattern('50%*'), '50\\%%');
  });
});

describe('wildcardToRegExp', () => {
  test('* matches any run of characters, found anywhere in the description (same as a plain substring match)', () => {
    assert.ok(wildcardToRegExp('COST*').test('COSTCO WHOLESALE'));
    assert.ok(wildcardToRegExp('COST*').test('BEST COSTCO'), 'no start/end anchoring — COST* matches wherever COST appears, same as this app\'s existing plain substring rules');
    assert.ok(!wildcardToRegExp('COST*').test('GROCERY STORE'), 'no match when the literal part is not present at all');
  });

  test('? matches exactly one character', () => {
    assert.ok(wildcardToRegExp('SQ ?THE BARN').test('SQ *THE BARN COUNTRY STORE'));
    assert.ok(!wildcardToRegExp('SQ ?THE BARN').test('SQ THE BARN'), '? must match exactly one character, not zero');
  });

  test('other regex-special characters in the pattern are escaped, not treated as regex syntax', () => {
    assert.ok(wildcardToRegExp('MICROSOFT#G173232359').test('MICROSOFT#G173232359 HALIFAX NS'));
    assert.ok(wildcardToRegExp('A (B) C').test('X A (B) C Y'), 'parentheses in a real payee name must be literal, not a regex group');
  });

  test('matching is case-insensitive, matching the rest of this app\'s payee matching', () => {
    assert.ok(wildcardToRegExp('costco*').test('COSTCO WHOLESALE'));
  });
});
