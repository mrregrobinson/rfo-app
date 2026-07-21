const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PORT, ACTIVITY_FX, activityImpact, getEffectivePort } = require('../public/finance.js');

describe('activityImpact', () => {
  test('outflow from a tracked class shrinks both that class and the total', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 2000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, -2000000);
    assert.equal(classDelta['Cash'], -2000000);
  });

  test('inflow into a tracked class grows both that class and the total', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 500000, currency: 'CAD', decreaseClass: null, increaseClass: 'Cash', status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, 500000);
    assert.equal(classDelta['Cash'], 500000);
  });

  test('pure reallocation between two classes leaves total unchanged and shifts them oppositely', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 600000, currency: 'CAD', decreaseClass: 'Real Assets', increaseClass: 'Cash', status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, 0);
    assert.equal(classDelta['Real Assets'], -600000);
    assert.equal(classDelta['Cash'], 600000);
  });

  test('an activity with no class on either side is fully external and touches nothing', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 750000, currency: 'CAD', decreaseClass: null, increaseClass: null, status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, 0);
    assert.deepEqual(classDelta, {});
  });

  test('applies the ACTIVITY_FX rate for non-CAD currencies', () => {
    const { totalDelta } = activityImpact([
      { amount: 1000, currency: 'USD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, -1000 * ACTIVITY_FX.USD);
  });

  test('unknown currency defaults to a 1:1 rate', () => {
    const { totalDelta } = activityImpact([
      { amount: 1000, currency: 'XYZ', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, -1000);
  });

  test('completed activities are excluded entirely', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 2000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Completed', timing: 'Uncertain' },
    ]);
    assert.equal(totalDelta, 0);
    assert.deepEqual(classDelta, {});
  });

  test('nearTermOnly excludes activities outside the near-term timing buckets', () => {
    const activities = [
      { amount: 1000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '24+ months' },
      { amount: 500000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '6-12 months' },
    ];
    const near = activityImpact(activities, { nearTermOnly: true });
    assert.equal(near.totalDelta, -500000, 'only the 6-12 month activity should count');

    const all = activityImpact(activities, { nearTermOnly: false });
    assert.equal(all.totalDelta, -1500000, 'both activities count without the filter');
  });

  test('multiple activities accumulate correctly', () => {
    const { totalDelta, classDelta } = activityImpact([
      { amount: 2000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '6-12 months' },
      { amount: 600000, currency: 'CAD', decreaseClass: 'Real Assets', increaseClass: 'Cash', status: 'Considering', timing: 'Uncertain' },
      { amount: 1000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '12-24 months' },
    ]);
    // Two pure outflows from Cash (-2,000,000 and -1,000,000) plus one pure
    // reallocation (Real Assets -> Cash, net zero on totalDelta).
    assert.equal(totalDelta, -3000000);
    assert.equal(classDelta['Cash'], -2000000 + 600000 - 1000000);
    assert.equal(classDelta['Real Assets'], -600000);
  });

  test('empty or missing activities list is a no-op', () => {
    assert.deepEqual(activityImpact([]), { totalDelta: 0, classDelta: {} });
    assert.deepEqual(activityImpact(undefined), { totalDelta: 0, classDelta: {} });
  });
});

describe('getEffectivePort', () => {
  test('with no activities, matches the static PORT allocation', () => {
    const eff = getEffectivePort([]);
    assert.equal(eff.totalCAD, PORT.totalCAD);
    for (const cls of Object.keys(PORT.alloc)) {
      assert.ok(Math.abs(eff.alloc[cls] - PORT.alloc[cls]) < 1e-9, `${cls} allocation should be unchanged`);
    }
  });

  test('percentages always sum to ~100 regardless of activities', () => {
    const activities = [
      { amount: 2000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '6-12 months' },
      { amount: 600000, currency: 'CAD', decreaseClass: 'Real Assets', increaseClass: 'Cash', status: 'Considering', timing: 'Uncertain' },
    ];
    const eff = getEffectivePort(activities);
    const sum = Object.values(eff.alloc).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-6, `allocations should sum to 100, got ${sum}`);
  });

  test('an outflow from a class shrinks total CAD by the same amount', () => {
    const eff = getEffectivePort([
      { amount: 2000000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: '6-12 months' },
    ]);
    assert.equal(eff.totalCAD, PORT.totalCAD - 2000000);
  });

  test('a pure reallocation leaves totalCAD unchanged', () => {
    const eff = getEffectivePort([
      { amount: 600000, currency: 'CAD', decreaseClass: 'Real Assets', increaseClass: 'Cash', status: 'Considering', timing: 'Uncertain' },
    ]);
    assert.equal(eff.totalCAD, PORT.totalCAD);
    // Cash's CAD amount should rise by exactly the reallocated amount.
    const baseCash = (PORT.alloc['Cash'] / 100) * PORT.totalCAD;
    assert.ok(Math.abs(eff.allocCAD['Cash'] - (baseCash + 600000)) < 1e-6);
  });
});
