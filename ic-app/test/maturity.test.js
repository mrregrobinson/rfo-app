// Maturity Assessment module — see RFO_Maturity_App_BuildSpec_v1 §10.2.
// Mounts the real routes on a throwaway express app with a stubbed session (same harness
// as the expenditure tests), against a fresh seeded database.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const tmpDbPath = path.join(os.tmpdir(), `ic-maturity-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;
process.env.ANTHROPIC_API_KEY = ''; // force the not-configured path for Claude endpoints

const db = require('../server/db');
const { ensureSeeded } = require('../server/seed');
const registerMaturityRoutes = require('../server/maturity');
const { levelRollup, levelClass } = require('../server/maturity');

ensureSeeded();

// act as whichever user the test sets; default to the admin (reg)
let CURRENT_USER = 'reg';
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.session = { userId: CURRENT_USER }; next(); });
registerMaturityRoutes(app, { db, logAudit: () => {} });

let server, baseUrl;
const as = (u) => { CURRENT_USER = u; };
const get = (p) => fetch(baseUrl + p, {}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const send = (m, p, b) => fetch(baseUrl + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

before(() => new Promise((res) => { server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; res(); }); }));
after(() => new Promise((res) => {
  server.close(() => {
    db.close();
    for (const s of ['', '-wal', '-shm']) { const f = tmpDbPath + s; if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch {} } }
    res();
  });
}));

describe('levelRollup / levelClass', () => {
  const qs = [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }];
  test('weighted mean, rounded to the nearest 0.5, clamped 1..5', () => {
    assert.equal(levelRollup([{ questionId: 'a', value: 4 }, { questionId: 'b', value: 4 }, { questionId: 'c', value: 3 }], qs), 3.5); // 3.67 -> 3.5
    assert.equal(levelRollup([{ questionId: 'a', value: 5 }, { questionId: 'b', value: 5 }, { questionId: 'c', value: 4 }], qs), 4.5); // 4.67 -> 4.5
    assert.equal(levelRollup([{ questionId: 'a', value: 1 }, { questionId: 'b', value: 1 }, { questionId: 'c', value: 1 }], qs), 1);
    assert.equal(levelRollup([], qs), null);
  });
  test('weight is respected', () => {
    const w = [{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }];
    assert.equal(levelRollup([{ questionId: 'a', value: 4 }, { questionId: 'b', value: 1 }], w), 3); // (8+1)/3 = 3
  });
  test('levelClass bands match the server', () => {
    assert.deepEqual([1, 1.5, 2, 3, 4, 4.5, 5].map(levelClass), ['l1', 'l1', 'l2', 'l3', 'l4', 'l4', 'l5']);
  });
});

describe('seed — the Appendix B reference round', () => {
  test('16 services in 5 categories with 80 level descriptors', () => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_services').get().n, 16);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_service_groups').get().n, 5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_level_descriptors').get().n, 80);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_level_labels').get().n, 5);
  });
  test('reference round is closed, not the anchor, and carries no benchmarks', () => {
    const r = db.prepare("SELECT * FROM maturity_rounds WHERE id = 'round-2026-baseline'").get();
    assert.equal(r.status, 'closed');
    assert.equal(r.is_anchor, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_benchmarks WHERE round_id = ?').get(r.id).n, 0);
  });
  test('10 services scored, 6 not assessed — means match Appendix B', async () => {
    const scored = db.prepare('SELECT COUNT(DISTINCT service_id) n FROM maturity_service_scores').get().n;
    assert.equal(scored, 10);
    const mean = (svc) => db.prepare('SELECT AVG(level) a FROM maturity_service_scores WHERE service_id = ?').get(svc).a;
    assert.equal(mean('svc-02'), 3);       // Governance (3.5+3+2.5+3)/4
    assert.equal(mean('svc-03'), 2.375);   // Risk Management (3+2+1.5+3)/4
    assert.equal(mean('svc-07'), 4.25);    // Passive Investment (4+5+4+4)/4
    assert.equal(db.prepare("SELECT COUNT(*) n FROM maturity_service_scores WHERE service_id = 'svc-01'").get().n, 0); // Strategy: not assessed
  });
  test('overview reproduces the reference scorecard', async () => {
    as('lucas');
    const { body } = await get('/api/maturity/overview?round=round-2026-baseline');
    assert.equal(body.services.length, 16);
    const gov = body.services.find((s) => s.id === 'svc-02');
    assert.equal(gov.stats.mean, 3);
    assert.equal(gov.stats.min, 2.5);
    assert.equal(gov.stats.max, 3.5);
    assert.equal(gov.descriptors.length, 5);
  });
});

describe('round lifecycle', () => {
  let roundId;
  test('a member cannot start a round; an admin can', async () => {
    as('lucas');
    assert.equal((await send('POST', '/api/maturity/rounds', { label: 'X' })).status, 403);
    as('reg');
    const r = await send('POST', '/api/maturity/rounds', { label: '2026 H2' });
    assert.equal(r.status, 201);
    roundId = r.body.id;
  });
  test('only one draft/open round at a time', async () => {
    as('reg');
    assert.equal((await send('POST', '/api/maturity/rounds', { label: 'again' })).status, 400);
  });
  test('responses cannot be saved until the round is open', async () => {
    as('ross');
    const r = await send('PUT', '/api/maturity/responses', { roundId, serviceId: 'svc-03', responses: [] });
    assert.equal(r.status, 400);
  });
  test('open -> answer -> computed level -> submit -> shows in the scorecard', async () => {
    as('reg');
    assert.equal((await send('POST', `/api/maturity/rounds/${roundId}/open`, {})).status, 200);

    as('ross');
    const detail = (await get(`/api/maturity/services/svc-03?round=${roundId}`)).body;
    const qs = detail.questions;
    const responses = qs.map((q) => ({ questionId: q.id, value: q.responseKind === 'level_pick' ? 4 : 4 }));
    const saved = await send('PUT', '/api/maturity/responses', { roundId, serviceId: 'svc-03', responses });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.computedLevel, 4); // all 4s

    const sub = await send('POST', '/api/maturity/services/svc-03/submit', { roundId });
    assert.equal(sub.status, 200);

    const ov = (await get(`/api/maturity/overview?round=${roundId}`)).body;
    assert.equal(ov.services.find((s) => s.id === 'svc-03').stats.byUser.ross, 4);
  });
  test('closing without benchmarks does not create an anchor', async () => {
    as('reg');
    const c = await send('POST', `/api/maturity/rounds/${roundId}/close`, {});
    assert.equal(c.status, 200);
    assert.equal(c.body.isAnchor, false);
    assert.equal(db.prepare('SELECT is_anchor FROM maturity_rounds WHERE id = ?').get(roundId).is_anchor, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_round_snapshots WHERE round_id = ?').get(roundId).n, 1);
  });
  test('closing WITH benchmarks stamps the first anchor', async () => {
    as('reg');
    const r2 = (await send('POST', '/api/maturity/rounds', { label: '2027 H1', carryFrom: roundId })).body.id;
    await send('POST', `/api/maturity/rounds/${r2}/open`, {});
    // carry-forward pre-filled ross's svc-03 score (unsubmitted)
    const ov = (await get(`/api/maturity/overview?round=${r2}`)).body;
    // stub a benchmark row directly (Claude is not configured in this test)
    db.prepare(
      `INSERT INTO maturity_benchmarks (id, round_id, service_id, benchmark_level, rationale, what_would_move_up, sources, caveats, model, searched_by, searched_at)
       VALUES ('b1', ?, 'svc-03', 3.5, 'stub', '[]', '[]', '', 'test', 'reg', ?)`
    ).run(r2, new Date().toISOString());
    const c = await send('POST', `/api/maturity/rounds/${r2}/close`, {});
    assert.equal(c.body.isAnchor, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM maturity_rounds WHERE is_anchor = 1").get().n, 1);
  });
});

describe('carry-forward pre-fill', () => {
  test('opening a round with carryFrom seeds unsubmitted scores from the prior round', () => {
    // r2 above carried from the H2 round; ross's svc-03 = 4 was submitted there
    const r2 = db.prepare("SELECT id FROM maturity_rounds WHERE label = '2027 H1'").get().id;
    const row = db.prepare("SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = 'svc-03' AND user_id = 'ross'").get(r2);
    assert.ok(row);
    assert.equal(row.level, 4);
    assert.equal(row.submitted, 0);
    assert.match(row.rationale, /Carried forward/);
  });
});

describe('Claude endpoints degrade when not configured', () => {
  test('benchmark returns configured:false', async () => {
    as('reg');
    const r = await send('POST', '/api/maturity/rounds/round-2026-baseline/benchmark', { serviceId: 'svc-01' });
    assert.equal(r.body.configured, false);
  });
  test('descriptor suggestions require a draft round and degrade', async () => {
    as('reg');
    const draft = (await send('POST', '/api/maturity/rounds', { label: 'draft-for-suggest' })).body.id;
    const r = await send('POST', `/api/maturity/rounds/${draft}/suggest-descriptors`, { serviceId: 'svc-01' });
    assert.equal(r.body.configured, false);
    // a closed round refuses
    const bad = await send('POST', '/api/maturity/rounds/round-2026-baseline/suggest-descriptors', {});
    assert.equal(bad.status, 400);
    // tidy up so other suites still see "one active round" rules cleanly
    db.prepare('DELETE FROM maturity_rounds WHERE id = ?').run(draft);
  });
});

describe('actions <-> Family Task List', () => {
  test('create, promote to a task, read through, unlink', async () => {
    as('reg');
    const a = (await send('POST', '/api/maturity/actions', { serviceId: 'svc-13', title: 'Roll out MFA everywhere', priority: 'Immediate' })).body;
    assert.ok(a.id);
    assert.equal(a.taskId, null);

    const promoted = await send('POST', `/api/maturity/actions/${a.id}/promote`, { categoryId: 'maturity', assignedToAll: true });
    assert.equal(promoted.status, 200);
    assert.ok(promoted.body.taskId);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(promoted.body.taskId);
    assert.equal(task.category_id, 'maturity');
    assert.match(task.notes, /From Maturity/);

    // mark the task done in the Task List -> action reads through
    db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
    const after = (await get('/api/maturity/actions')).body.actions.find((x) => x.id === a.id);
    assert.equal(after.effectiveStatus, 'done');

    const unlinked = await send('POST', `/api/maturity/actions/${a.id}/unlink`, {});
    assert.equal(unlinked.body.taskId, null);
  });
});

describe('Capital Consciousness submit gate', () => {
  test('cannot submit until placed on every dimension', async () => {
    as('reg');
    const roundId = (await send('POST', '/api/maturity/rounds', { label: 'cc-round' })).body.id;
    await send('POST', `/api/maturity/rounds/${roundId}/open`, {});
    as('lucas');
    const dims = (await get(`/api/maturity/cc?round=${roundId}`)).body.dimensions;
    // place on all but one
    await send('PUT', '/api/maturity/cc-responses', { roundId, responses: dims.slice(1).map((d) => ({ dimensionId: d.id, level: 3 })) });
    assert.equal((await send('POST', '/api/maturity/cc/submit', { roundId })).status, 400);
    await send('PUT', '/api/maturity/cc-responses', { roundId, responses: [{ dimensionId: dims[0].id, level: 3 }] });
    assert.equal((await send('POST', '/api/maturity/cc/submit', { roundId })).status, 200);
    as('reg');
    db.prepare('DELETE FROM maturity_cc_responses WHERE round_id = ?').run(roundId);
    db.prepare('DELETE FROM maturity_rounds WHERE id = ?').run(roundId);
  });
});
