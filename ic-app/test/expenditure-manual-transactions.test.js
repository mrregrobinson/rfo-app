// Exercises manually-added transactions — for a real expense that never shows up on any
// of the household's own imported statements, most commonly a personal expense actually
// paid from a business account this ledger doesn't track. See server/expenditure.js's
// POST /api/expenditure/transactions/manual.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-expmanual-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const fx = require('../server/fx');
const registerExpenditureRoutes = require('../server/expenditure');

const USER_ID = 'test-user';
const LEDGER_ID = 'test-ledger';
const OTHER_LEDGER_ID = 'other-ledger';

db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Test User', 'Required', 'TU', '#000000')").run(USER_ID);
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(LEDGER_ID, 'Test Ledger', new Date().toISOString());
db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(LEDGER_ID, USER_ID, 'admin');
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(OTHER_LEDGER_ID, 'Other Ledger', new Date().toISOString());
const categoryId = crypto.randomUUID();
const unknownCategoryId = crypto.randomUUID();
db.prepare("INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order, role) VALUES (?, ?, 'Kids & Family', 1, 0, NULL)").run(categoryId, LEDGER_ID);
db.prepare("INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order, role) VALUES (?, ?, 'Miscellaneous/Unknown', 1, 1, 'unknown')").run(unknownCategoryId, LEDGER_ID);

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

async function post(pathname, body) {
  const r = await fetch(`${baseUrl}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function get(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`);
  return { status: r.status, body: await r.json() };
}

describe('POST /api/expenditure/transactions/manual', () => {
  test('creates a transaction under a new "manual" pseudo-account named after the source', async () => {
    const { status, body } = await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'Kids swimming lessons — paid from business account', txnDate: '2026-06-15', amount: 240, categoryId,
    });
    assert.equal(status, 201);
    assert.equal(body.accountName, 'R&R Keys Corp');
    assert.equal(body.description, 'Kids swimming lessons — paid from business account');
    assert.equal(body.amount, 240);
    assert.equal(body.amountCad, 240);
    assert.equal(body.currency, 'CAD');
    assert.equal(body.categoryId, categoryId);
    assert.equal(body.isTransfer, false, 'a manual entry is never run through transfer/income detection');

    const account = db.prepare("SELECT * FROM expenditure_accounts WHERE ledger_id = ? AND account_type = 'manual'").get(LEDGER_ID);
    assert.equal(account.name, 'R&R Keys Corp');
    assert.equal(account.currency, 'CAD');
  });

  test('a second entry from the same source reuses the same pseudo-account, not a new one', async () => {
    await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'Another personal expense', txnDate: '2026-06-20', amount: 50, categoryId,
    });
    const accounts = db.prepare("SELECT * FROM expenditure_accounts WHERE ledger_id = ? AND account_type = 'manual' AND name = 'R&R Keys Corp'").all(LEDGER_ID);
    assert.equal(accounts.length, 1, 'reused, not duplicated');
  });

  test('two entries from the same source on the same day share one statement, not one each', async () => {
    const account = db.prepare("SELECT * FROM expenditure_accounts WHERE ledger_id = ? AND account_type = 'manual' AND name = 'R&R Keys Corp'").get(LEDGER_ID);
    await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'Same-day expense one', txnDate: '2026-07-01', amount: 10, categoryId,
    });
    await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'Same-day expense two', txnDate: '2026-07-01', amount: 20, categoryId,
    });
    const statements = db.prepare('SELECT * FROM expenditure_statements WHERE account_id = ? AND period_start = ? AND period_end = ?').all(account.id, '2026-07-01', '2026-07-01');
    assert.equal(statements.length, 1, 'one shared statement for that day, not two');
  });

  test('a different source name gets its own separate pseudo-account', async () => {
    await post('/api/expenditure/transactions/manual', {
      sourceName: 'Rewire Collections', description: 'Personal item bought via Rewire', txnDate: '2026-06-16', amount: 75, categoryId,
    });
    const accounts = db.prepare("SELECT name FROM expenditure_accounts WHERE ledger_id = ? AND account_type = 'manual'").all(LEDGER_ID);
    assert.deepEqual(accounts.map((a) => a.name).sort(), ['R&R Keys Corp', 'Rewire Collections']);
  });

  test('with no categoryId given, falls back to existing category rules, then Miscellaneous/Unknown', async () => {
    const { body } = await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'UNCATEGORIZED MANUAL ITEM', txnDate: '2026-06-17', amount: 15,
    });
    assert.equal(body.categoryId, unknownCategoryId);
  });

  test('converts a non-CAD amount using the daily rate for the transaction date', async () => {
    const rateMock = mock.method(fx, 'getDailyRate', async (date, pair) => {
      assert.equal(date, '2026-06-18');
      assert.equal(pair, 'USDCAD');
      return 1.36;
    });
    try {
      const { status, body } = await post('/api/expenditure/transactions/manual', {
        sourceName: 'R&R Keys Corp', description: 'US expense paid personally', txnDate: '2026-06-18', amount: 100, currency: 'USD', categoryId,
      });
      assert.equal(status, 201);
      assert.equal(body.currency, 'USD');
      assert.equal(body.amount, 100);
      assert.equal(body.fxRate, 1.36);
      assert.equal(body.amountCad, 136);
    } finally {
      rateMock.mock.restore();
    }
  });

  test('a failed FX lookup is reported clearly, and nothing is inserted', async () => {
    const rateMock = mock.method(fx, 'getDailyRate', async () => { throw new Error('rate service unavailable'); });
    try {
      const before_ = db.prepare('SELECT COUNT(*) AS n FROM expenditure_transactions').get().n;
      const { status, body } = await post('/api/expenditure/transactions/manual', {
        sourceName: 'R&R Keys Corp', description: 'Should not be saved', txnDate: '2026-06-19', amount: 50, currency: 'USD', categoryId,
      });
      assert.equal(status, 502);
      assert.match(body.error, /exchange rate/);
      const after_ = db.prepare('SELECT COUNT(*) AS n FROM expenditure_transactions').get().n;
      assert.equal(after_, before_, 'no partial row left behind');
    } finally {
      rateMock.mock.restore();
    }
  });

  test('rejects a category from a different ledger', async () => {
    const otherCategoryId = crypto.randomUUID();
    db.prepare("INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, 'Other Ledger Category', 1, 0)").run(otherCategoryId, OTHER_LEDGER_ID);
    const { status } = await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'X', txnDate: '2026-06-20', amount: 10, categoryId: otherCategoryId,
    });
    assert.equal(status, 404);
  });

  test('rejects missing sourceName, description, txnDate, or a zero/non-numeric amount', async () => {
    const base = { sourceName: 'R&R Keys Corp', description: 'X', txnDate: '2026-06-20', amount: 10 };
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, sourceName: '' })).status, 400);
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, description: '' })).status, 400);
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, txnDate: '' })).status, 400);
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, txnDate: 'not-a-date' })).status, 400);
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, amount: 0 })).status, 400);
    assert.equal((await post('/api/expenditure/transactions/manual', { ...base, amount: 'abc' })).status, 400);
  });

  test('a manually-added transaction shows up in the normal transactions list and summary, just like an imported one', async () => {
    const { body: created } = await post('/api/expenditure/transactions/manual', {
      sourceName: 'R&R Keys Corp', description: 'VISIBLE IN MAIN LIST', txnDate: '2026-06-21', amount: 33, categoryId,
    });
    const { body: list } = await get('/api/expenditure/transactions');
    assert.ok(list.some((t) => t.id === created.id));
    const { body: summary } = await get('/api/expenditure/summary');
    assert.ok(summary.total >= 33);
  });
});

describe('GET /api/expenditure/manual-sources', () => {
  test('lists distinct manual source names, scoped to the caller\'s own ledger', async () => {
    const { status, body } = await get('/api/expenditure/manual-sources');
    assert.equal(status, 200);
    assert.deepEqual(body.sort(), ['R&R Keys Corp', 'Rewire Collections']);
  });
});
