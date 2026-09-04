const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isTransferOrIncome, detectAccountFromFilename } = require('../server/expenditure');

describe('isTransferOrIncome', () => {
  test('an internal transfer between the household\'s own accounts is excluded', () => {
    assert.equal(isTransferOrIncome('Online Banking transfer - 2591', 'chequing', 32), true);
    assert.equal(isTransferOrIncome('Account transfer RR KEYS CORP', 'chequing', 1000), true);
    assert.equal(isTransferOrIncome('Online Banking payment - 1427', 'chequing', 1918.86), true);
  });

  test('capital movements (investments, funds transfers) are excluded', () => {
    assert.equal(isTransferOrIncome('Investment TREZ CAPITAL', 'chequing', 15000), true);
    assert.equal(isTransferOrIncome('Funds transfer fee TT ICAPITAL BLU', 'chequing', 3362.88), true);
  });

  test('interest (income) is excluded — out of scope for this app, not just "a transfer"', () => {
    assert.equal(isTransferOrIncome('Deposit interest', 'chequing', -538.73), true);
    assert.equal(isTransferOrIncome('Interest WMILP Operating', 'chequing', -0.24), true);
  });

  test('a genuine recurring household cost is NOT excluded, even if it sounds transfer-adjacent', () => {
    assert.equal(isTransferOrIncome('Property Tax CityOf Waterloo', 'chequing', 1900), false);
  });

  test('an e-Transfer to a real vendor for real services is NOT excluded — only internal-transfer wording is', () => {
    assert.equal(isTransferOrIncome('e-Transfer sent Red Bear Landscaping', 'chequing', 231), false);
    assert.equal(isTransferOrIncome('e-Transfer sent Dobson Yard Care', 'chequing', 500), false);
    assert.equal(isTransferOrIncome('e-Transfer sent Jodi Kingdon V7FC9L', 'chequing', 17), false);
  });

  test('a credit card payment (paying down the card from chequing) is excluded — it is the transfer side of spending already itemized on the card', () => {
    assert.equal(isTransferOrIncome('PAYMENT - THANK YOU', 'credit_card', -15000), true);
    assert.equal(isTransferOrIncome('Payment received', 'credit_card', -10000), true);
  });

  test('a refund/credit for a returned purchase on the card is NOT excluded — it is real (negative) spending, not a transfer', () => {
    assert.equal(isTransferOrIncome('MICROSOFT#G173232359 HALIFAX NS', 'credit_card', -26.87), false);
  });

  test('an ordinary purchase is never excluded', () => {
    assert.equal(isTransferOrIncome('CLEAR LAKE GOLF COURSE WASAGAMING MB', 'credit_card', 111.68), false);
    assert.equal(isTransferOrIncome('HERITAGE COOP ERIC GROC ERICKSON MB', 'credit_card', 76.81), false);
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
