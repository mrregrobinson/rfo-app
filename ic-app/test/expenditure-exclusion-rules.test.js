// Exercises the exclusion-rule management endpoints added so a household member can
// manage transfer/income detection the same way they manage categorization rules,
// instead of it being hardcoded in server/expenditure.js — see
// server/expenditure-defaults.js and migration 024.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-expexclusion-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const registerExpenditureRoutes = require('../server/expenditure');

const USER_ID = 'test-user';
const LEDGER_ID = 'test-ledger';
const OTHER_LEDGER_ID = 'other-ledger';

db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Test User', 'Required', 'TU', '#000000')").run(USER_ID);
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(LEDGER_ID, 'Test Ledger', new Date().toISOString());
db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(LEDGER_ID, USER_ID, 'admin');
// A second ledger this user is NOT a member of, to confirm exclusion rules (like
// everything else in this app) never leak or apply across ledgers.
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(OTHER_LEDGER_ID, 'Other Ledger', new Date().toISOString());

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

async function get(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`);
  return { status: r.status, body: await r.json() };
}
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

function makeTxn({ description, amount, accountType = 'chequing', isTransfer = 0 }) {
  const accountId = crypto.randomUUID();
  const statementId = crypto.randomUUID();
  const txnId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO expenditure_accounts (id, ledger_id, name, account_type, currency, created_at) VALUES (?, ?, 'Test Account', ?, 'CAD', ?)`).run(accountId, LEDGER_ID, accountType, now);
  db.prepare(`INSERT INTO expenditure_statements (id, account_id, period_start, period_end, imported_at) VALUES (?, ?, '2026-04-01', '2026-04-30', ?)`).run(statementId, accountId, now);
  db.prepare(`INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, description, raw_description, amount, currency, amount_cad, category_id, is_transfer, created_at) VALUES (?, ?, ?, '2026-04-15', ?, ?, ?, 'CAD', ?, NULL, ?, ?)`)
    .run(txnId, accountId, statementId, description, description, amount, amount, isTransfer, now);
  return txnId;
}

describe('exclusion rule management', () => {
  test('starts with no rules for a freshly created ledger', async () => {
    const { status, body } = await get('/api/expenditure/exclusion-rules');
    assert.equal(status, 200);
    assert.deepEqual(body, []);
  });

  test('adding a rule', async () => {
    const { status, body } = await post('/api/expenditure/exclusion-rules', { pattern: 'RENT TO OWN CORP' });
    assert.equal(status, 201);
    assert.equal(body.rule.pattern, 'RENT TO OWN CORP');
    assert.equal(body.rule.matchType, 'substring');
    assert.equal(body.rule.direction, 'any');
    assert.equal(body.rule.accountType, 'any');
    assert.equal(body.excluded, 0, 'applyToExisting was not requested');
  });

  test('rejects a rule with no pattern', async () => {
    const { status } = await post('/api/expenditure/exclusion-rules', {});
    assert.equal(status, 400);
  });

  test('adding a rule with applyToExisting immediately reclassifies matching transactions as transfers', async () => {
    const matching = makeTxn({ description: 'e-Transfer sent COUSIN LOAN REPAY', amount: 500 });
    const nonMatching = makeTxn({ description: 'GROCERY STORE PURCHASE', amount: 80 });

    const { status, body } = await post('/api/expenditure/exclusion-rules', { pattern: 'COUSIN LOAN REPAY', applyToExisting: true });
    assert.equal(status, 201);
    assert.equal(body.excluded, 1);

    const m = db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(matching);
    assert.equal(m.is_transfer, 1);
    const n = db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(nonMatching);
    assert.equal(n.is_transfer, 0, 'unrelated spending must not be swept in');
  });

  test('a direction:negative rule only excludes money coming in', async () => {
    const incoming = makeTxn({ description: 'CONTRACTOR REBATE DEPOSIT', amount: -200 });
    const outgoing = makeTxn({ description: 'CONTRACTOR REBATE DEPOSIT FEE', amount: 15 });

    const { body } = await post('/api/expenditure/exclusion-rules', {
      pattern: 'CONTRACTOR REBATE DEPOSIT', direction: 'negative', applyToExisting: true,
    });
    assert.equal(body.excluded, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(incoming).is_transfer, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(outgoing).is_transfer, 0);
  });

  test('an accountType:credit_card rule does not apply to a chequing transaction with the same wording', async () => {
    const onCard = makeTxn({ description: 'BALANCE TRANSFER FEE XYZ', amount: 25, accountType: 'credit_card' });
    const onChequing = makeTxn({ description: 'BALANCE TRANSFER FEE XYZ', amount: 25, accountType: 'chequing' });

    const { body } = await post('/api/expenditure/exclusion-rules', {
      pattern: 'BALANCE TRANSFER FEE XYZ', accountType: 'credit_card', applyToExisting: true,
    });
    assert.equal(body.excluded, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(onCard).is_transfer, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(onChequing).is_transfer, 0);
  });

  test('a regex rule with anchoring only matches at the start of the description', async () => {
    const atStart = makeTxn({ description: 'XFER-INTERNAL SWEEP 991', amount: 300 });
    const notAtStart = makeTxn({ description: 'PURCHASE VIA XFER-INTERNAL PARTNER', amount: 40 });

    const { body } = await post('/api/expenditure/exclusion-rules', {
      pattern: '^xfer-internal', matchType: 'regex', applyToExisting: true,
    });
    assert.equal(body.excluded, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(atStart).is_transfer, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(notAtStart).is_transfer, 0);
  });

  test('editing a rule\'s pattern re-evaluates against the NEW pattern, not the old one', async () => {
    const { body: created } = await post('/api/expenditure/exclusion-rules', { pattern: 'OLD EXCLUSION TEXT' });
    const newlyMatching = makeTxn({ description: 'BRAND NEW EXCLUSION TEXT', amount: 60 });
    const oldMatching = makeTxn({ description: 'OLD EXCLUSION TEXT STILL HERE', amount: 60 });

    const { status, body } = await put(`/api/expenditure/exclusion-rules/${created.rule.id}`, {
      pattern: 'NEW EXCLUSION*', matchType: 'substring', applyToExisting: true,
    });
    assert.equal(status, 200);
    assert.equal(body.rule.pattern, 'NEW EXCLUSION*');
    assert.equal(body.excluded, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(newlyMatching).is_transfer, 1);
    assert.equal(db.prepare('SELECT is_transfer FROM expenditure_transactions WHERE id = ?').get(oldMatching).is_transfer, 0, 'no longer matches the edited rule');
  });

  test('editing a nonexistent rule 404s', async () => {
    const { status } = await put('/api/expenditure/exclusion-rules/does-not-exist', { pattern: 'X' });
    assert.equal(status, 404);
  });

  test('editing a rule to an empty pattern is rejected and leaves it unchanged', async () => {
    const { body: created } = await post('/api/expenditure/exclusion-rules', { pattern: 'KEEP ME' });
    const { status } = await put(`/api/expenditure/exclusion-rules/${created.rule.id}`, { pattern: '   ' });
    assert.equal(status, 400);
    const row = db.prepare('SELECT pattern FROM expenditure_exclusion_rules WHERE id = ?').get(created.rule.id);
    assert.equal(row.pattern, 'KEEP ME');
  });

  test('deleting a rule removes it and stops it from applying to future reclassification', async () => {
    const { body: created } = await post('/api/expenditure/exclusion-rules', { pattern: 'TEMPORARY EXCLUSION RULE' });
    const { status, body } = await del(`/api/expenditure/exclusion-rules/${created.rule.id}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);

    const list = await get('/api/expenditure/exclusion-rules');
    assert.ok(!list.body.some((r) => r.id === created.rule.id));
  });

  test('deleting a nonexistent rule 404s', async () => {
    const { status } = await del('/api/expenditure/exclusion-rules/does-not-exist');
    assert.equal(status, 404);
  });

  test('a rule belonging to a different ledger cannot be edited, deleted, or seen', async () => {
    const otherRuleId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO expenditure_exclusion_rules (id, ledger_id, pattern, match_type, direction, account_type, priority, created_at)
       VALUES (?, ?, 'OTHER LEDGERS RULE', 'substring', 'any', 'any', 0, ?)`
    ).run(otherRuleId, OTHER_LEDGER_ID, new Date().toISOString());

    const list = await get('/api/expenditure/exclusion-rules');
    assert.ok(!list.body.some((r) => r.id === otherRuleId), 'must not appear in this session\'s ledger listing');

    const putResult = await put(`/api/expenditure/exclusion-rules/${otherRuleId}`, { pattern: 'HIJACKED' });
    assert.equal(putResult.status, 404);
    const delResult = await del(`/api/expenditure/exclusion-rules/${otherRuleId}`);
    assert.equal(delResult.status, 404);

    const stillThere = db.prepare('SELECT pattern FROM expenditure_exclusion_rules WHERE id = ?').get(otherRuleId);
    assert.equal(stillThere.pattern, 'OTHER LEDGERS RULE', 'unchanged and not deleted');
  });
});
