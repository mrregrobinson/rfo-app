// Regression test for the bug reported after the first real deploy: importing a zip of
// several statements timed out at the hosting platform's reverse-proxy layer, because the
// whole import ran inline inside one HTTP request/response cycle — fine locally, but
// Railway's edge proxy kills a request long before a multi-statement Claude extraction
// finishes. This exercises the actual Express routes (not just the pure helpers) to prove
// the fix's real property: the POST responds immediately with a job id, and the
// extraction work — mocked here to a short delay, since this must run fast and offline —
// happens afterward, observable only through polling GET .../import/:jobId.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-expimport-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const claude = require('../server/claude');
const registerExpenditureRoutes = require('../server/expenditure');

const USER_ID = 'test-user';
const LEDGER_ID = 'test-ledger';

db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Test User', 'Required', 'TU', '#000000')").run(USER_ID);
db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(LEDGER_ID, 'Test Ledger', new Date().toISOString());
db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(LEDGER_ID, USER_ID, 'admin');
const categoryId = crypto.randomUUID();
db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 1, 0)').run(categoryId, LEDGER_ID, 'Miscellaneous/Unknown');

const app = express();
app.use(express.json({ limit: '10mb' }));
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

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

describe('POST /api/expenditure/import', () => {
  test('responds immediately with a jobId rather than blocking until extraction finishes', async () => {
    // Asserting on a flag the mocked extraction sets when IT finishes — not on a
    // wall-clock threshold — since an absolute-time assertion is inherently flaky under
    // system load (e.g. running the whole suite at once, vs. this file alone) even
    // though the actual property under test (the POST doesn't wait for extraction) never
    // changes.
    let extractionFinished = false;
    const extractMock = mock.method(claude, 'extractStatement', async () => {
      await delay(300); // stands in for a real multi-minute Claude call
      extractionFinished = true;
      return {
        result: {
          periodStart: '2026-01-01', periodEnd: '2026-01-31',
          summary: { openingBalance: 1000, closingBalance: 900, totalDeposits: 0, totalWithdrawals: 100 },
          transactions: [{ date: '2026-01-15', postDate: null, description: 'TEST GROCERY STORE', amount: 100 }],
        },
        usage: {},
      };
    });
    try {
      const postRes = await fetch(`${baseUrl}/api/expenditure/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [{ filename: 'R&S CAD Chequing 5000344 Statement-0344 2026-01-31.pdf', base64: 'ZmFrZQ==' }] }),
      });
      assert.equal(postRes.status, 202);
      const body = await postRes.json();
      assert.ok(body.jobId, 'should return a jobId');
      assert.equal(body.total, 1);
      assert.equal(extractionFinished, false, 'POST should return before the mocked extraction finishes, not after');

      // Immediately after: the job should still be running, not yet reflecting the
      // extraction that's still in flight.
      const immediate = await (await fetch(`${baseUrl}/api/expenditure/import/${body.jobId}`)).json();
      assert.equal(immediate.status, 'running');
      assert.equal(immediate.completed, 0);

      // Poll until done (bounded so a real regression fails the test instead of hanging).
      let job;
      for (let i = 0; i < 20; i++) {
        await delay(100);
        job = await (await fetch(`${baseUrl}/api/expenditure/import/${body.jobId}`)).json();
        if (job.status !== 'running') break;
      }
      assert.equal(job.status, 'done');
      assert.equal(job.completed, 1);
      assert.equal(job.results.length, 1);
      assert.equal(job.results[0].ok, true);
      assert.equal(job.results[0].reconciliationStatus, 'ok');
      assert.equal(job.results[0].transactionCount, 1);
    } finally {
      extractMock.mock.restore();
    }
  });

  test('re-importing the same statement filename skips it without calling Claude again', async () => {
    const extractMock = mock.method(claude, 'extractStatement', async () => ({
      result: {
        periodStart: '2026-02-01', periodEnd: '2026-02-28',
        summary: { openingBalance: 500, closingBalance: 400, totalDeposits: 0, totalWithdrawals: 100 },
        transactions: [{ date: '2026-02-15', postDate: null, description: 'TEST PHARMACY', amount: 100 }],
      },
      usage: {},
    }));
    const filename = 'R&S CAD Chequing 5000344 Statement-0344 2026-02-28.pdf';
    try {
      async function runImport() {
        const postRes = await fetch(`${baseUrl}/api/expenditure/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ filename, base64: 'ZmFrZQ==' }] }),
        });
        const { jobId } = await postRes.json();
        let job;
        for (let i = 0; i < 20; i++) {
          await delay(50);
          job = await (await fetch(`${baseUrl}/api/expenditure/import/${jobId}`)).json();
          if (job.status !== 'running') break;
        }
        return job;
      }

      const first = await runImport();
      assert.equal(first.results[0].ok, true);
      assert.equal(first.results[0].skipped, undefined);
      assert.equal(extractMock.mock.calls.length, 1, 'first import should call extraction once');

      const second = await runImport();
      assert.equal(second.results[0].skipped, true, 'the fast-path filename-date check should catch this without extracting');
      assert.equal(second.results[0].reason, 'Already imported');
      assert.equal(extractMock.mock.calls.length, 1, 'second import of the same filename should NOT call extraction again');
    } finally {
      extractMock.mock.restore();
    }
  });

  test('an unrecognized filename is reported as a per-file error, not a whole-job failure', async () => {
    const postRes = await fetch(`${baseUrl}/api/expenditure/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'unknown-bank-statement.pdf', base64: 'ZmFrZQ==' }] }),
    });
    const { jobId } = await postRes.json();
    let job;
    for (let i = 0; i < 20; i++) {
      await delay(50);
      job = await (await fetch(`${baseUrl}/api/expenditure/import/${jobId}`)).json();
      if (job.status !== 'running') break;
    }
    assert.equal(job.status, 'done');
    assert.equal(job.results[0].ok, false);
    assert.match(job.results[0].error, /Unrecognized statement filename/);
  });

  test('a job from one ledger is not visible to a request scoped to a different ledger', async () => {
    const otherUserId = 'other-user';
    const otherLedgerId = 'other-ledger';
    db.prepare("INSERT INTO users (id, name, role, initials, color) VALUES (?, 'Other User', 'Required', 'OU', '#111111')").run(otherUserId);
    db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(otherLedgerId, 'Other Ledger', new Date().toISOString());
    db.prepare('INSERT INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(otherLedgerId, otherUserId, 'admin');

    const postRes = await fetch(`${baseUrl}/api/expenditure/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ filename: 'unknown-bank-statement.pdf', base64: 'ZmFrZQ==' }] }),
    });
    const { jobId } = await postRes.json();

    const otherApp = express();
    otherApp.use(express.json());
    otherApp.use((req, res, next) => { req.session = { userId: otherUserId }; next(); });
    registerExpenditureRoutes(otherApp, { db, logAudit: () => {} });
    const otherServer = await new Promise((resolve) => { const s = otherApp.listen(0, () => resolve(s)); });
    try {
      const otherPort = otherServer.address().port;
      const res = await fetch(`http://localhost:${otherPort}/api/expenditure/import/${jobId}`);
      assert.equal(res.status, 404);
    } finally {
      await new Promise((resolve) => otherServer.close(resolve));
    }
  });
});
