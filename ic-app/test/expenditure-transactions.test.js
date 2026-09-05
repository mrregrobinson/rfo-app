// Exercises the transaction update endpoints — in particular the bulk "select all and
// exclude" action added after a real user asked for a faster way to mark a batch of
// transactions (e.g. every payroll deposit) excluded than one checkbox at a time.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-exptxns-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const registerExpenditureRoutes = require('../server/expenditure');

const USER_ID = 'test-user';
const LEDGER_ID = 'test-ledger';
const ACCOUNT_ID = crypto.randomUUID();
const STATEMENT_ID = crypto.randomUUID();
let categoryAId, categoryBId;
const txnIds = [];

db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Test User', 'Required', 'TU', '#000000')").run(USER_ID);
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(LEDGER_ID, 'Test Ledger', new Date().toISOString());
db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(LEDGER_ID, USER_ID, 'admin');
categoryAId = crypto.randomUUID();
categoryBId = crypto.randomUUID();
const transfersId = crypto.randomUUID();
db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 0, 99)').run(transfersId, LEDGER_ID, 'Transfers');
db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 1, 0)').run(categoryAId, LEDGER_ID, 'Category A');
db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 1, 1)').run(categoryBId, LEDGER_ID, 'Category B');
const now = new Date().toISOString();
db.prepare(`INSERT INTO expenditure_accounts (id, ledger_id, name, account_type, currency, created_at) VALUES (?, ?, 'Test Account', 'chequing', 'CAD', ?)`).run(ACCOUNT_ID, LEDGER_ID, now);
db.prepare(`INSERT INTO expenditure_statements (id, account_id, period_start, period_end, imported_at) VALUES (?, ?, '2026-01-01', '2026-01-31', ?)`).run(STATEMENT_ID, ACCOUNT_ID, now);
for (let i = 0; i < 3; i++) {
  const id = crypto.randomUUID();
  txnIds.push(id);
  db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-01-1${i}', 'Test payee', 'Test payee', 50, 'CAD', 50, ?, 0, ?)`).run(id, ACCOUNT_ID, STATEMENT_ID, categoryAId, now);
}

// One transaction belonging to a different ledger, to confirm bulk update can't reach
// across ledgers even if its id is included in the request.
const OTHER_LEDGER_ID = 'other-ledger';
const OTHER_ACCOUNT_ID = crypto.randomUUID();
const OTHER_STATEMENT_ID = crypto.randomUUID();
const otherTxnId = crypto.randomUUID();
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(OTHER_LEDGER_ID, 'Other Ledger', now);
db.prepare(`INSERT INTO expenditure_accounts (id, ledger_id, name, account_type, currency, created_at) VALUES (?, ?, 'Other Account', 'chequing', 'CAD', ?)`).run(OTHER_ACCOUNT_ID, OTHER_LEDGER_ID, now);
db.prepare(`INSERT INTO expenditure_statements (id, account_id, period_start, period_end, imported_at) VALUES (?, ?, '2026-01-01', '2026-01-31', ?)`).run(OTHER_STATEMENT_ID, OTHER_ACCOUNT_ID, now);
db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, is_transfer, created_at) VALUES (?, ?, ?, '2026-01-15', 'Other ledger payee', 'Other ledger payee', 50, 'CAD', 50, 0, ?)`).run(otherTxnId, OTHER_ACCOUNT_ID, OTHER_STATEMENT_ID, now);

const app = express();
app.use(express.json());
app.use((req, res, next) => { req.session = { userId: USER_ID }; next(); });
registerExpenditureRoutes(app, { db, logAudit: () => {} });

let server, baseUrl;
before(() => new Promise((resolve) => {
  server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; resolve(); });
}));

after(() => new Promise((resolve) => {
  server.close(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = tmpDbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    resolve();
  });
}));

async function putBulk(body) {
  const r = await fetch(`${baseUrl}/api/expenditure/transactions/bulk`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

describe('PUT /api/expenditure/transactions/bulk', () => {
  test('marks every selected transaction excluded in one call', async () => {
    const { status, body } = await putBulk({ ids: txnIds, isTransfer: true });
    assert.equal(status, 200);
    assert.equal(body.updated, 3);
    for (const id of txnIds) {
      const row = db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(id);
      assert.equal(row.is_transfer, 1);
    }
  });

  test('can also bulk re-include and bulk recategorize in the same call', async () => {
    const { status, body } = await putBulk({ ids: txnIds, isTransfer: false, categoryId: categoryBId });
    assert.equal(status, 200);
    assert.equal(body.updated, 3);
    for (const id of txnIds) {
      const row = db.prepare('SELECT is_transfer, category_id FROM expenditure_transactions WHERE id = ?').get(id);
      assert.equal(row.is_transfer, 0);
      assert.equal(row.category_id, categoryBId);
    }
  });

  test('cannot reach a transaction belonging to a different ledger', async () => {
    const { status, body } = await putBulk({ ids: [otherTxnId], isTransfer: true });
    assert.equal(status, 200);
    assert.equal(body.updated, 0, 'should not update a transaction outside the caller\'s ledger');
    const row = db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(otherTxnId);
    assert.equal(row.is_transfer, 0, 'unchanged');
  });

  test('rejects an empty ids array', async () => {
    const { status } = await putBulk({ ids: [], isTransfer: true });
    assert.equal(status, 400);
  });

  test('rejects a request with neither isTransfer nor categoryId', async () => {
    const { status } = await putBulk({ ids: txnIds });
    assert.equal(status, 400);
  });
});

describe('POST /api/expenditure/reclassify', () => {
  test('excludes a payroll deposit imported before that detection existed, and leaves ordinary spending alone', async () => {
    const payrollId = crypto.randomUUID();
    const groceryId = crypto.randomUUID();
    const alreadyExcludedId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-03-01', 'PAYROLL DEP ACME CORP', 'PAYROLL DEP ACME CORP', -3200, 'CAD', -3200, ?, 0, ?)`).run(payrollId, ACCOUNT_ID, STATEMENT_ID, categoryAId, now);
    db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-03-02', 'HERITAGE COOP GROC', 'HERITAGE COOP GROC', 76.81, 'CAD', 76.81, ?, 0, ?)`).run(groceryId, ACCOUNT_ID, STATEMENT_ID, categoryAId, now);
    db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-03-03', 'Some already-excluded transfer', 'Some already-excluded transfer', 500, 'CAD', 500, NULL, 1, ?)`).run(alreadyExcludedId, ACCOUNT_ID, STATEMENT_ID, now);

    const res = await fetch(`${baseUrl}/api/expenditure/reclassify`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.excluded, 1);
    assert.deepEqual(body.excludedExamples, ['PAYROLL DEP ACME CORP']);
    assert.equal(body.recategorized, 0);

    const payroll = db.prepare('SELECT is_transfer, category_id FROM expenditure_transactions WHERE id = ?').get(payrollId);
    assert.equal(payroll.is_transfer, 1);
    assert.equal(payroll.category_id, transfersId);

    const grocery = db.prepare('SELECT is_transfer, category_id FROM expenditure_transactions WHERE id = ?').get(groceryId);
    assert.equal(grocery.is_transfer, 0, 'ordinary spending must not be touched');
    assert.equal(grocery.category_id, categoryAId, 'and its category must not change — no rule exists for it yet');
  });

  test('running it again is a no-op once everything is already reclassified', async () => {
    const res = await fetch(`${baseUrl}/api/expenditure/reclassify`, { method: 'POST' });
    const body = await res.json();
    assert.equal(body.excluded, 0);
    assert.equal(body.recategorized, 0);
  });

  test('also re-applies existing category rules retroactively — the actual "clean up existing data" a user asked for after adding a rule', async () => {
    // A rule created for "HERITAGE COOP" — matching the grocery transaction from the
    // first test above, still sitting in categoryAId since no rule existed for it when
    // reclassify last ran. Created WITHOUT applyToExisting, so it must not move on its
    // own — this test is specifically about the separate /reclassify catch-up path, not
    // rule-creation's own (already-covered) immediate reclassification.
    const ruleRes = await fetch(`${baseUrl}/api/expenditure/category-rules`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'HERITAGE COOP', categoryId: categoryBId }),
    });
    assert.equal((await ruleRes.json()).reclassified, 0);
    const beforeReclassify = db.prepare('SELECT category_id FROM expenditure_transactions WHERE raw_description = ?').get('HERITAGE COOP GROC');
    assert.equal(beforeReclassify.category_id, categoryAId, 'unchanged immediately after creating the rule, since applyToExisting was not set');

    const res = await fetch(`${baseUrl}/api/expenditure/reclassify`, { method: 'POST' });
    const body = await res.json();
    assert.equal(body.recategorized, 1);

    const afterReclassify = db.prepare('SELECT category_id FROM expenditure_transactions WHERE raw_description = ?').get('HERITAGE COOP GROC');
    assert.equal(afterReclassify.category_id, categoryBId, 'reclassify should catch up the existing rule against existing data');
  });
});

describe('GET /api/expenditure/transactions — amount range and wildcard payee filters', () => {
  const now = new Date().toISOString();
  before(() => {
    const rows = [
      ['Costco Wholesale', 250],
      ['Costco Gas Bar', 60],
      ['SQ *THE BARN COUNTRY STORE', 45],
      ['MICROSOFT#G173232359', 15.99],
    ];
    for (const [description, amount] of rows) {
      db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-04-01', ?, ?, ?, 'CAD', ?, ?, 0, ?)`)
        .run(crypto.randomUUID(), ACCOUNT_ID, STATEMENT_ID, description, description, amount, amount, categoryAId, now);
    }
  });

  async function query(params) {
    const r = await fetch(`${baseUrl}/api/expenditure/transactions?${new URLSearchParams(params)}`);
    return r.json();
  }

  test('amountMin/amountMax filter on the CAD amount', async () => {
    const overFifty = await query({ amountMin: '50' });
    assert.ok(overFifty.some((t) => t.description === 'Costco Wholesale'));
    assert.ok(!overFifty.some((t) => t.description === 'MICROSOFT#G173232359'));

    // Checks presence/absence of specific rows rather than the exact result set, since
    // the file's other pre-existing "Test payee" fixture rows (amount 50 each) also
    // legitimately fall within this range and aren't this test's concern.
    const between = await query({ amountMin: '20', amountMax: '60' });
    const namesInRange = ['Costco Gas Bar', 'SQ *THE BARN COUNTRY STORE'];
    for (const name of namesInRange) assert.ok(between.some((t) => t.description === name), `expected ${name} in range`);
    assert.ok(!between.some((t) => t.description === 'Costco Wholesale'), 'above the max, should be excluded');
    assert.ok(!between.some((t) => t.description === 'MICROSOFT#G173232359'), 'below the min, should be excluded');
  });

  test('a plain payee search with no wildcard matches as a substring, as before', async () => {
    const results = await query({ payee: 'Costco' });
    assert.deepEqual(results.map((t) => t.description).sort(), ['Costco Gas Bar', 'Costco Wholesale']);
  });

  test('* wildcard narrows a plain substring search to a prefix/suffix match', async () => {
    const results = await query({ payee: 'Costco Gas*' });
    assert.deepEqual(results.map((t) => t.description), ['Costco Gas Bar']);
  });

  test('? wildcard matches exactly one character', async () => {
    const results = await query({ payee: 'SQ ?THE BARN*' });
    assert.deepEqual(results.map((t) => t.description), ['SQ *THE BARN COUNTRY STORE']);
  });

  test('a literal special character (#) in the payee search works normally alongside escaping of %/_ ', async () => {
    const results = await query({ payee: 'MICROSOFT#G173232359' });
    assert.deepEqual(results.map((t) => t.description), ['MICROSOFT#G173232359']);
  });
});
