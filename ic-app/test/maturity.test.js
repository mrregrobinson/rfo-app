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
process.env.ANTHROPIC_API_KEY = ''; // force the not-configured path for the research/extraction endpoints

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
const del = (p) => fetch(baseUrl + p, { method: 'DELETE' }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

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
  test('16 services in 5 categories with 80 level descriptors, 4 questions each', () => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_services').get().n, 16);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_service_groups').get().n, 5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_level_descriptors').get().n, 80);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_level_labels').get().n, 5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_questions').get().n, 16 * 4);
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
  test('7 Capital Consciousness statements are seeded, one per level', () => {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_consciousness_statements').get().n, 7);
    assert.deepEqual(db.prepare('SELECT level FROM maturity_consciousness_statements ORDER BY level').all().map((r) => r.level), [1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('round lifecycle — maturity worksheet only, no per-service consciousness', () => {
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
  test('open -> answer the worksheet -> maturity level is derived, no consciousness field on it', async () => {
    as('reg');
    assert.equal((await send('POST', `/api/maturity/rounds/${roundId}/open`, {})).status, 200);

    as('ross');
    const detail = (await get(`/api/maturity/services/svc-03?round=${roundId}`)).body;
    assert.equal(detail.questions.length, 4);
    assert.ok(!('axis' in detail.questions[0]), 'questions carry no axis field any more');
    assert.ok(!('consciousnessLevels' in detail), 'no per-service consciousness payload');

    const responses = detail.questions.map((q) => ({ questionId: q.id, value: 4 })); // answer everything "agree"
    const saved = await send('PUT', '/api/maturity/responses', { roundId, serviceId: 'svc-03', responses });
    assert.equal(saved.body.computedLevel, 4);
    assert.ok(!('computedConsciousnessLevel' in saved.body));

    assert.equal((await send('POST', '/api/maturity/services/svc-03/submit', { roundId })).status, 200);

    const ov = (await get(`/api/maturity/overview?round=${roundId}`)).body;
    const svc = ov.services.find((s) => s.id === 'svc-03');
    assert.equal(svc.stats.byUser.ross, 4);
    assert.ok(!('consciousness' in svc.stats), 'serviceStats no longer carries a consciousness sub-object');
  });
  test('submitting only requires the maturity level', async () => {
    as('sd');
    const detail = (await get(`/api/maturity/services/svc-02?round=${roundId}`)).body;
    const responses = detail.questions.map((q) => ({ questionId: q.id, value: 3 }));
    const saved = await send('PUT', '/api/maturity/responses', { roundId, serviceId: 'svc-02', responses });
    assert.ok(saved.body.computedLevel != null);
    assert.equal((await send('POST', '/api/maturity/services/svc-02/submit', { roundId })).status, 200);
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
    db.prepare(
      `INSERT INTO maturity_benchmarks (id, round_id, service_id, peer_level, peer_rationale, what_would_move_up, sources, caveats, model, searched_by, searched_at)
       VALUES ('b1', ?, 'svc-03', 3.5, 'stub', '[]', '[]', '', 'test', 'reg', ?)`
    ).run(r2, new Date().toISOString());
    const c = await send('POST', `/api/maturity/rounds/${r2}/close`, {});
    assert.equal(c.body.isAnchor, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM maturity_rounds WHERE is_anchor = 1").get().n, 1);
  });
});

describe('carry-forward pre-fill', () => {
  test('opening a round with carryFrom seeds an unsubmitted maturity score from the prior round', () => {
    const r2 = db.prepare("SELECT id FROM maturity_rounds WHERE label = '2027 H1'").get().id;
    const row = db.prepare("SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = 'svc-03' AND user_id = 'ross'").get(r2);
    assert.ok(row);
    assert.equal(row.level, 4);
    assert.equal(row.submitted, 0);
    assert.match(row.rationale, /Carried forward/);
  });
});

describe('endpoints degrade when the research/extraction feature is not configured', () => {
  test('benchmark returns configured:false', async () => {
    as('reg');
    const r = await send('POST', '/api/maturity/rounds/round-2026-baseline/benchmark', { serviceId: 'svc-01' });
    assert.equal(r.body.configured, false);
  });
  test('wording suggestions work for a draft OR an open round, refuse a closed one, and degrade without the feature configured', async () => {
    as('reg');
    const draft = (await send('POST', '/api/maturity/rounds', { label: 'draft-for-suggest' })).body.id;
    const draftResult = await send('POST', `/api/maturity/rounds/${draft}/suggest-wording`, { serviceId: 'svc-01' });
    assert.equal(draftResult.body.configured, false);
    await send('POST', `/api/maturity/rounds/${draft}/open`, {});
    const openResult = await send('POST', `/api/maturity/rounds/${draft}/suggest-wording`, { serviceId: 'svc-01' });
    assert.equal(openResult.body.configured, false); // still reaches the call, just degrades — not refused for being open
    // a closed round refuses
    const bad = await send('POST', '/api/maturity/rounds/round-2026-baseline/suggest-wording', {});
    assert.equal(bad.status, 400);
    // tidy up so other suites still see "one active round" rules cleanly
    db.prepare('DELETE FROM maturity_rounds WHERE id = ?').run(draft);
  });
});

describe('invite family to assess — admin-triggered only, never automatic', () => {
  let draft;
  test('a draft round refuses (must be open); a member cannot trigger it', async () => {
    as('reg');
    draft = (await send('POST', '/api/maturity/rounds', { label: 'draft-for-invite' })).body.id;
    const onDraft = await send('POST', `/api/maturity/rounds/${draft}/invite`, {});
    assert.equal(onDraft.status, 400);
    await send('POST', `/api/maturity/rounds/${draft}/open`, {});
    as('lucas');
    assert.equal((await send('POST', `/api/maturity/rounds/${draft}/invite`, {})).status, 403);
  });
  test('opening the round does not itself send anything; an admin must explicitly invite, and it degrades cleanly with no mail server configured', async () => {
    as('reg');
    // nothing was sent as a side effect of opening the round above
    const r = await send('POST', `/api/maturity/rounds/${draft}/invite`, { userIds: ['ross'] });
    assert.equal(r.status, 503); // ANTHROPIC_API_KEY-style: MS_GRAPH_* isn't configured in tests either
    assert.match(r.body.error, /not configured/i);
  });
  test('unknown round 404s', async () => {
    as('reg');
    assert.equal((await send('POST', '/api/maturity/rounds/does-not-exist/invite', {})).status, 404);
    db.prepare('DELETE FROM maturity_rounds WHERE id = ?').run(draft);
  });
});

describe('benchmark — two independent numbers (peer + assessed), and a recommendation weighing them', () => {
  test('the service detail endpoint surfaces both levels, both rationales, and the recommendation', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO maturity_benchmarks (id, round_id, service_id, peer_level, peer_rationale, assessed_level, assessed_rationale, recommended_priority, recommendation, what_would_move_up, sources, caveats, model, searched_by, searched_at)
       VALUES ('bench-rec-1', 'round-2026-baseline', 'svc-08', 4, 'compared against Campden/FOE surveys for this size', 2, 'their own descriptors describe an ad hoc process, not the documented one they self-scored', 'Immediate', 'Our own read of this family sits well below a comparable office, and below their own self-score too — a wide, consequential gap.', '["do X","do Y"]', '[]', '', 'test', 'reg', ?)`
    ).run(now);
    as('reg');
    const detail = (await get('/api/maturity/services/svc-08?round=round-2026-baseline')).body;
    assert.equal(detail.benchmark.peerLevel, 4);
    assert.match(detail.benchmark.peerRationale, /Campden\/FOE/);
    assert.equal(detail.benchmark.assessedLevel, 2);
    assert.match(detail.benchmark.assessedRationale, /ad hoc process/);
    assert.equal(detail.benchmark.recommendedPriority, 'Immediate');
    assert.match(detail.benchmark.recommendation, /wide, consequential gap/);
    assert.deepEqual(detail.benchmark.whatWouldMoveUp, ['do X', 'do Y']);
    db.prepare("DELETE FROM maturity_benchmarks WHERE id = 'bench-rec-1'").run();
  });
  test('assessedLevel is nullable — a row without it (predating migration 042) still returns cleanly, with priority defaulting to Monitor', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO maturity_benchmarks (id, round_id, service_id, peer_level, peer_rationale, what_would_move_up, sources, caveats, model, searched_by, searched_at)
       VALUES ('bench-legacy-1', 'round-2026-baseline', 'svc-09', 3, 'old-shape row', '[]', '[]', '', 'test', 'reg', ?)`
    ).run(now);
    as('reg');
    const detail = (await get('/api/maturity/services/svc-09?round=round-2026-baseline')).body;
    assert.equal(detail.benchmark.peerLevel, 3);
    assert.equal(detail.benchmark.assessedLevel, null);
    assert.equal(detail.benchmark.recommendedPriority, 'Monitor');
    assert.equal(detail.benchmark.recommendation, '');
    db.prepare("DELETE FROM maturity_benchmarks WHERE id = 'bench-legacy-1'").run();
  });
});

describe('consolidated wording-suggestions review list — Manage tab, not buried per-service', () => {
  test('GET /api/maturity/rounds/:id/wording-suggestions returns pending level + question suggestions with service context, and excludes already-reviewed ones', async () => {
    const svc = db.prepare("SELECT id, number, name FROM maturity_services WHERE id = 'svc-06'").get();
    const questions = db.prepare('SELECT id, prompt, help_text FROM maturity_questions WHERE service_id = ? ORDER BY sort_order').all(svc.id);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO maturity_descriptor_suggestions (id, round_id, service_id, level, current_text, suggested_text, rationale, sources, status, model, searched_at)
       VALUES ('dsug-list', 'round-2026-baseline', ?, 3, 'old text', 'new text', 'clearer', '[]', 'pending', 'test', ?)`
    ).run(svc.id, now);
    db.prepare(
      `INSERT INTO maturity_question_suggestions (id, round_id, service_id, question_id, current_prompt, current_help_text, suggested_prompt, suggested_help_text, rationale, sources, status, model, searched_at)
       VALUES ('qsug-list-pending', 'round-2026-baseline', ?, ?, ?, ?, 'new prompt', 'new help', 'sharper', '[]', 'pending', 'test', ?)`
    ).run(svc.id, questions[0].id, questions[0].prompt, questions[0].help_text, now);
    // an already-reviewed one (accepted, in this case) must NOT show up as pending
    db.prepare(
      `INSERT INTO maturity_question_suggestions (id, round_id, service_id, question_id, current_prompt, current_help_text, suggested_prompt, suggested_help_text, rationale, sources, status, model, searched_at)
       VALUES ('qsug-list-accepted', 'round-2026-baseline', ?, ?, ?, ?, 'already handled', '', '', '[]', 'accepted', 'test', ?)`
    ).run(svc.id, questions[1].id, questions[1].prompt, questions[1].help_text, now);

    as('reg');
    const r = await get('/api/maturity/rounds/round-2026-baseline/wording-suggestions');
    assert.equal(r.status, 200);
    const d = r.body.descriptors.find((x) => x.id === 'dsug-list');
    assert.ok(d);
    assert.equal(d.serviceId, svc.id);
    assert.equal(d.serviceNumber, svc.number);
    assert.equal(d.serviceName, svc.name);
    assert.equal(d.suggestedText, 'new text');
    const qr = r.body.questions.find((x) => x.id === 'qsug-list-pending');
    assert.ok(qr);
    assert.equal(qr.suggestedPrompt, 'new prompt');
    assert.ok(!r.body.questions.some((x) => x.id === 'qsug-list-accepted'), 'already-reviewed suggestions are not listed as pending');

    // cleaned up so other suites still see a clean baseline round
    db.prepare("DELETE FROM maturity_descriptor_suggestions WHERE id = 'dsug-list'").run();
    db.prepare("DELETE FROM maturity_question_suggestions WHERE id IN ('qsug-list-pending','qsug-list-accepted')").run();
  });
});

describe('question wording suggestions — tailored per service, not the standardized template', () => {
  test('the review queue is per-question (not per-service) and accepting one edits only that question', async () => {
    const svc = db.prepare("SELECT id FROM maturity_services WHERE id = 'svc-04'").get();
    const q = db.prepare('SELECT id, prompt, help_text FROM maturity_questions WHERE service_id = ? ORDER BY sort_order LIMIT 1').get(svc.id);
    const now = new Date().toISOString();
    // stub what suggestServiceWording would have produced — nothing is configured in
    // tests, so this exercises the review-queue schema and the accept/dismiss routes
    // directly, the same way maturity_benchmarks rows are stubbed elsewhere in this file
    const sugId = 'qsug-1';
    db.prepare(
      `INSERT INTO maturity_question_suggestions (id, round_id, service_id, question_id, current_prompt, current_help_text, suggested_prompt, suggested_help_text, rationale, sources, status, model, searched_at)
       VALUES (?, 'round-2026-baseline', ?, ?, ?, ?, ?, ?, 'more specific to this service', '[]', 'pending', 'test', ?)`
    ).run(sugId, svc.id, q.id, q.prompt, q.help_text, 'A tailored, service-specific version of the question', 'Tailored help text', now);

    as('lucas');
    assert.equal((await send('POST', `/api/maturity/question-suggestions/${sugId}/accept`, {})).status, 403); // member cannot accept

    as('reg');
    const accepted = await send('POST', `/api/maturity/question-suggestions/${sugId}/accept`, {});
    assert.equal(accepted.status, 200);
    const updated = db.prepare('SELECT prompt, help_text FROM maturity_questions WHERE id = ?').get(q.id);
    assert.equal(updated.prompt, 'A tailored, service-specific version of the question');
    assert.equal(updated.help_text, 'Tailored help text');
    const sugRow = db.prepare('SELECT status FROM maturity_question_suggestions WHERE id = ?').get(sugId);
    assert.equal(sugRow.status, 'accepted');

    // other questions on the same service are untouched
    const otherQ = db.prepare('SELECT prompt FROM maturity_questions WHERE service_id = ? AND id != ? LIMIT 1').get(svc.id, q.id);
    assert.notEqual(otherQ.prompt, 'A tailored, service-specific version of the question');
  });

  test('dismiss leaves the question untouched', async () => {
    const svc = db.prepare("SELECT id FROM maturity_services WHERE id = 'svc-05'").get();
    const q = db.prepare('SELECT id, prompt FROM maturity_questions WHERE service_id = ? ORDER BY sort_order LIMIT 1').get(svc.id);
    const now = new Date().toISOString();
    const sugId = 'qsug-2';
    db.prepare(
      `INSERT INTO maturity_question_suggestions (id, round_id, service_id, question_id, current_prompt, current_help_text, suggested_prompt, suggested_help_text, rationale, sources, status, model, searched_at)
       VALUES (?, 'round-2026-baseline', ?, ?, ?, '', 'A different wording', '', '', '[]', 'pending', 'test', ?)`
    ).run(sugId, svc.id, q.id, q.prompt, now);
    as('reg');
    assert.equal((await send('POST', `/api/maturity/question-suggestions/${sugId}/dismiss`, {})).status, 200);
    assert.equal(db.prepare('SELECT prompt FROM maturity_questions WHERE id = ?').get(q.id).prompt, q.prompt);
    assert.equal(db.prepare('SELECT status FROM maturity_question_suggestions WHERE id = ?').get(sugId).status, 'dismissed');
  });
});

describe('direct question editing — no review required (PUT /api/maturity/questions/:qid)', () => {
  test('an admin can edit a question\'s wording directly, with no suggestion involved and regardless of round status', async () => {
    const q = db.prepare("SELECT id, prompt, help_text, weight, sort_order, response_kind FROM maturity_questions WHERE service_id = 'svc-07' ORDER BY sort_order LIMIT 1").get();
    as('lucas');
    assert.equal((await send('PUT', `/api/maturity/questions/${q.id}`, { prompt: 'nope' })).status, 403); // member cannot edit

    as('reg');
    const r = await send('PUT', `/api/maturity/questions/${q.id}`, { prompt: 'Edited directly, no review involved', helpText: 'a hand-written help text' });
    assert.equal(r.status, 200);
    const updated = db.prepare('SELECT prompt, help_text, weight, sort_order, response_kind FROM maturity_questions WHERE id = ?').get(q.id);
    assert.equal(updated.prompt, 'Edited directly, no review involved');
    assert.equal(updated.help_text, 'a hand-written help text');
    // untouched fields survive a partial update
    assert.equal(updated.weight, q.weight);
    assert.equal(updated.sort_order, q.sort_order);
    assert.equal(updated.response_kind, q.response_kind);

    // no suggestion row of any kind was created or needed for this
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_question_suggestions WHERE question_id = ?').get(q.id).n, 0);
  });
  test('unknown question 404s', async () => {
    as('reg');
    assert.equal((await send('PUT', '/api/maturity/questions/does-not-exist', { prompt: 'x' })).status, 404);
  });
});

describe('service grounding context — real evidence feeding the benchmark, not a generic blurb', () => {
  test('all 16 services seed with a non-empty, distinct description', () => {
    const rows = db.prepare('SELECT id, description FROM maturity_services ORDER BY number').all();
    assert.equal(rows.length, 16);
    for (const r of rows) assert.ok(r.description && r.description.length > 20, `${r.id} should have real description text`);
    const distinct = new Set(rows.map((r) => r.description));
    assert.equal(distinct.size, 16, 'every service should have its own description, not a shared placeholder');
  });
  test('an admin can edit a service description directly (PUT /api/maturity/services/:id), no review required', async () => {
    const before = db.prepare("SELECT description FROM maturity_services WHERE id = 'svc-09'").get().description;
    as('lucas');
    assert.equal((await send('PUT', '/api/maturity/services/svc-09', { description: 'nope' })).status, 403); // member cannot edit
    as('reg');
    const r = await send('PUT', '/api/maturity/services/svc-09', { description: 'Updated directly by an admin, no suggestion involved.' });
    assert.equal(r.status, 200);
    assert.equal(db.prepare("SELECT description FROM maturity_services WHERE id = 'svc-09'").get().description, 'Updated directly by an admin, no suggestion involved.');
    // name is untouched by a description-only partial update
    assert.equal(db.prepare("SELECT name FROM maturity_services WHERE id = 'svc-09'").get().name, 'Philanthropy');
    // restore, so other suites relying on the seeded description aren't affected
    db.prepare("UPDATE maturity_services SET description = ? WHERE id = 'svc-09'").run(before);
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

describe('Capital Consciousness — standalone, once per round, a single pick (§5.8)', () => {
  let roundId;
  test('the per-service consciousness schema, and the old ranking table, are both gone; /cc serves the 7 statements + scale', async () => {
    for (const t of ['maturity_cc_dimensions', 'maturity_cc_prompts', 'maturity_cc_responses', 'maturity_consciousness_responses']) {
      assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name = ?").get(t).n, 0, `${t} should be dropped`);
    }
    for (const col of ['consciousness_level', 'computed_consciousness_level', 'consciousness_method', 'consciousness_note']) {
      const cols = db.prepare('PRAGMA table_info(maturity_service_scores)').all().map((c) => c.name);
      assert.ok(!cols.includes(col), `${col} should be dropped from maturity_service_scores`);
    }
    as('reg');
    const r = await send('POST', '/api/maturity/rounds', { label: 'cc-round' });
    roundId = r.body.id;
    await send('POST', `/api/maturity/rounds/${roundId}/open`, {});
    const cc = (await get(`/api/maturity/cc?round=${roundId}`)).body;
    assert.equal(cc.levels.length, 7);
    assert.equal(cc.statements.length, 7);
    assert.ok(cc.question && cc.question.intro && cc.question.reflectionPrompt);
    assert.ok(!('myResponses' in cc), 'no more per-statement responses to report');
    assert.equal(cc.myScore, null);
  });
  test('picking a statement sets the level directly; submitting requires a pick', async () => {
    as('ross');
    const cc = (await get(`/api/maturity/cc?round=${roundId}`)).body;
    assert.equal(cc.statements.length, 7);

    // cannot submit before picking anything
    assert.equal((await send('POST', '/api/maturity/consciousness/submit', { roundId })).status, 400);

    // an out-of-range / non-existent statement level is rejected
    assert.equal((await send('PUT', '/api/maturity/consciousness-pick', { roundId, level: 9 })).status, 400);

    const picked = await send('PUT', '/api/maturity/consciousness-pick', { roundId, level: 5 });
    assert.equal(picked.status, 200);
    assert.equal(picked.body.level, 5);
    let row = db.prepare("SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = 'ross'").get(roundId);
    assert.equal(row.level, 5);
    assert.equal(row.computed_level, 5);
    assert.equal(row.method, 'questionnaire');

    // changing your mind just re-picks — no separate "un-pick" step needed
    await send('PUT', '/api/maturity/consciousness-pick', { roundId, level: 3 });
    row = db.prepare("SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = 'ross'").get(roundId);
    assert.equal(row.level, 3);

    // a note can be saved on its own, without re-picking
    await send('PUT', '/api/maturity/consciousness-pick', { roundId, note: 'discussed as a family over dinner' });
    row = db.prepare("SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = 'ross'").get(roundId);
    assert.equal(row.level, 3); // unchanged
    assert.equal(row.note, 'discussed as a family over dinner');

    // cannot submit before picking at all (a fresh member with nothing recorded yet)
    as('lucas');
    assert.equal((await send('POST', '/api/maturity/consciousness/submit', { roundId })).status, 400);

    as('ross');
    assert.equal((await send('POST', '/api/maturity/consciousness/submit', { roundId })).status, 200);
    const mine = (await get(`/api/maturity/cc?round=${roundId}`)).body.myScore;
    assert.equal(mine.submitted, true);
    assert.equal(mine.method, 'questionnaire');
    assert.equal(mine.level, 3);
    assert.equal(mine.note, 'discussed as a family over dinner');
  });
  test('family summary rolls up every submitted member', async () => {
    as('lucas');
    assert.equal((await send('PUT', '/api/maturity/consciousness-pick', { roundId, level: 2 })).status, 200);
    assert.equal((await send('POST', '/api/maturity/consciousness/submit', { roundId })).status, 200);

    as('reg');
    const cc = (await get(`/api/maturity/cc?round=${roundId}`)).body;
    assert.equal(cc.summary.count, 2); // ross + lucas
    assert.ok(cc.summary.cog != null);
    const members = cc.summary.members;
    assert.ok(members.find((m) => m.userId === 'lucas' && m.level === 2));
    assert.ok(members.find((m) => m.userId === 'ross' && m.level === 3 && m.note));
  });
  test('DELETE /api/maturity/rounds/:id removes every trace and reassigns the anchor if needed', async () => {
    as('lucas');
    assert.equal((await del(`/api/maturity/rounds/${roundId}`)).status, 403); // member cannot delete
    as('reg');
    const before = db.prepare('SELECT COUNT(*) n FROM maturity_consciousness_scores WHERE round_id = ?').get(roundId).n;
    assert.ok(before > 0);
    const r = await del(`/api/maturity/rounds/${roundId}`);
    assert.equal(r.status, 200);
    assert.equal(db.prepare('SELECT * FROM maturity_rounds WHERE id = ?').get(roundId), undefined);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_consciousness_scores WHERE round_id = ?').get(roundId).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM maturity_service_scores WHERE round_id = ?').get(roundId).n, 0);
    // deleting a nonexistent round 404s
    assert.equal((await del(`/api/maturity/rounds/${roundId}`)).status, 404);
  });
  test('deleting the anchor round promotes the next-earliest closed round with benchmarks', async () => {
    as('reg');
    const anchorId = db.prepare('SELECT id FROM maturity_rounds WHERE is_anchor = 1').get().id;
    // give an older closed round its own benchmark so it can inherit anchor status
    const older = db.prepare("SELECT id FROM maturity_rounds WHERE id = 'round-2026-baseline'").get().id;
    db.prepare(
      `INSERT INTO maturity_benchmarks (id, round_id, service_id, peer_level, peer_rationale, what_would_move_up, sources, caveats, model, searched_by, searched_at)
       VALUES ('b-old', ?, 'svc-01', 3, 'stub', '[]', '[]', '', 'test', 'reg', ?)`
    ).run(older, new Date().toISOString());
    await del(`/api/maturity/rounds/${anchorId}`);
    assert.equal(db.prepare('SELECT is_anchor FROM maturity_rounds WHERE id = ?').get(older).is_anchor, 1);
  });
});
