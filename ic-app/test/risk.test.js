const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { scoreOf, bandOf, PRIORITIES, STATUS_VALUES } = require('../server/risk');
const seed = require('../server/risk-seed-data');

describe('risk scoring (P×I, fixed bands)', () => {
  test('scoreOf multiplies probability by impact', () => {
    assert.equal(scoreOf(3, 4), 12);
    assert.equal(scoreOf(1, 1), 1);
    assert.equal(scoreOf(2, 3), 6);
    assert.equal(scoreOf(4, 4), 16);
  });

  test('bandOf: 1–5 Low, 6–8 Medium, 9–16 High', () => {
    assert.equal(bandOf(1), 'Low');
    assert.equal(bandOf(5), 'Low');
    assert.equal(bandOf(6), 'Medium');
    assert.equal(bandOf(8), 'Medium');
    assert.equal(bandOf(9), 'High');
    assert.equal(bandOf(16), 'High');
  });

  test('the v5 register baseline aggregate exposure, computed from the reconciled seed', () => {
    // Transcribed straight from the source docs: inherent P×I sums to 103, residual to
    // 58 (the build spec's prose "~101 / ~60" was a rough estimate — the seed is
    // authoritative, and the app computes this live from risk_assessments anyway).
    const inherent = seed.CATEGORIES.reduce((s, c) => s + scoreOf(c.inherent[0], c.inherent[1]), 0);
    const residual = seed.CATEGORIES.reduce((s, c) => s + scoreOf(c.residual[0], c.residual[1]), 0);
    assert.equal(inherent, 103);
    assert.equal(residual, 58);
    assert.ok(residual < inherent, 'mitigation must reduce aggregate exposure');
  });
});

describe('risk seed data (reconciled v5)', () => {
  test('14 categories across 6 domains A–F, numbered 1–14', () => {
    assert.equal(seed.CATEGORIES.length, 14);
    assert.deepEqual(seed.DOMAINS.map((d) => d.id), ['A', 'B', 'C', 'D', 'E', 'F']);
    assert.deepEqual(
      seed.CATEGORIES.map((c) => c.number),
      Array.from({ length: 14 }, (_, i) => i + 1)
    );
  });

  test('Monetary Hedge is Risk 14 in Domain F (notes numbering, not the spreadsheet)', () => {
    const mh = seed.CATEGORIES.find((c) => c.title.startsWith('Monetary Hedge'));
    assert.equal(mh.number, 14);
    assert.equal(mh.domainId, 'F');
  });

  test('every category references a real domain and has 1–4 P/I scores', () => {
    const domainIds = new Set(seed.DOMAINS.map((d) => d.id));
    for (const c of seed.CATEGORIES) {
      assert.ok(domainIds.has(c.domainId), `${c.id} -> unknown domain ${c.domainId}`);
      for (const v of [...c.inherent, ...c.residual]) assert.ok(v >= 1 && v <= 4, `${c.id} score ${v} out of range`);
      assert.ok(STATUS_VALUES.includes(c.status), `${c.id} status "${c.status}" not a recognised value`);
      assert.ok(c.mitigations.length > 0, `${c.id} has no mitigations`);
      for (const a of c.actions) assert.ok(PRIORITIES.includes(a.priority), `${c.id} action priority "${a.priority}" invalid`);
    }
  });

  test('exactly the two Risk 9 estate items are seeded as incomplete', () => {
    const incomplete = seed.CATEGORIES.flatMap((c) => c.actions.filter((a) => a.status === 'incomplete'));
    assert.equal(incomplete.length, 2);
  });

  test('7 Immediate-priority actions, matching the notes’ "Immediate Action Required" summary', () => {
    const immediate = seed.CATEGORIES.flatMap((c) => c.actions.filter((a) => a.priority === 'Immediate'));
    assert.equal(immediate.length, 7);
  });
});
