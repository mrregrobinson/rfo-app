// Exercises the category management endpoints added after a real user asked "how do I
// add or change categories" and there was no way to — see server/expenditure.js's
// POST/PUT/DELETE /api/expenditure/categories.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-expcategories-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const registerExpenditureRoutes = require('../server/expenditure');

const USER_ID = 'test-user';
const LEDGER_ID = 'test-ledger';

db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Test User', 'Required', 'TU', '#000000')").run(USER_ID);
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(LEDGER_ID, 'Test Ledger', new Date().toISOString());
db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(LEDGER_ID, USER_ID, 'admin');

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
async function put(pathname, body) {
  const r = await fetch(`${baseUrl}${pathname}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
async function del(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`, { method: 'DELETE' });
  return { status: r.status, body: await r.json() };
}

describe('category management', () => {
  test('adding a category', async () => {
    const { status, body } = await post('/api/expenditure/categories', { name: 'Home Office' });
    assert.equal(status, 201);
    assert.equal(body.name, 'Home Office');
    assert.equal(body.isExpenditure, true);
  });

  test('renaming a category', async () => {
    const { body: created } = await post('/api/expenditure/categories', { name: 'Kids' });
    const { status, body } = await put(`/api/expenditure/categories/${created.id}`, { name: 'Kids & Family' });
    assert.equal(status, 200);
    assert.equal(body.name, 'Kids & Family');
  });

  test('flipping isExpenditure on a category', async () => {
    const { body: created } = await post('/api/expenditure/categories', { name: 'Loan Repayments' });
    const { body } = await put(`/api/expenditure/categories/${created.id}`, { isExpenditure: false });
    assert.equal(body.isExpenditure, false);
    assert.equal(body.name, 'Loan Repayments', 'name should be unchanged when only isExpenditure is sent');
  });

  test('deleting an unused category succeeds', async () => {
    const { body: created } = await post('/api/expenditure/categories', { name: 'Unused Category' });
    const { status, body } = await del(`/api/expenditure/categories/${created.id}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  test('deleting a category still referenced by a transaction is blocked with a clear count', async () => {
    const { body: category } = await post('/api/expenditure/categories', { name: 'In Use Category' });
    const accountId = crypto.randomUUID();
    const statementId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO expenditure_accounts (id, ledger_id, name, account_type, currency, created_at) VALUES (?, ?, 'Test Account', 'chequing', 'CAD', ?)`).run(accountId, LEDGER_ID, now);
    db.prepare(`INSERT INTO expenditure_statements (id, account_id, period_start, period_end, imported_at) VALUES (?, ?, '2026-01-01', '2026-01-31', ?)`).run(statementId, accountId, now);
    db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-01-05', 'Test purchase', 50, 'CAD', 50, ?, 0, ?)`).run(crypto.randomUUID(), accountId, statementId, category.id, now);

    const { status, body } = await del(`/api/expenditure/categories/${category.id}`);
    assert.equal(status, 400);
    assert.match(body.error, /used by 1 transaction/);
  });

  test('deleting a category still referenced by a rule is blocked', async () => {
    const { body: category } = await post('/api/expenditure/categories', { name: 'Rule-Bound Category' });
    await post('/api/expenditure/category-rules', { pattern: 'SOME PAYEE', categoryId: category.id });
    const { status, body } = await del(`/api/expenditure/categories/${category.id}`);
    assert.equal(status, 400);
    assert.match(body.error, /1 rule/);
  });

  test('renaming a nonexistent category 404s', async () => {
    const { status } = await put('/api/expenditure/categories/does-not-exist', { name: 'X' });
    assert.equal(status, 404);
  });
});
