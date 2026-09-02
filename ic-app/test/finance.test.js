const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { PORT, ACTIVITY_FX, activityImpact, getEffectivePort, capitalCallSchedule, unfundedCallScheduleCAD, incomeByBucketCAD, computeLiquidityPlan, LIQUIDITY_BUCKETS } = require('../public/finance.js');

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

describe('capitalCallSchedule', () => {
  test('paces 10/10/20/remaining of the commitment, capped at what is unfunded', () => {
    const s = capitalCallSchedule(1000000, 836857);
    assert.equal(s['0-6 months'], 100000);
    assert.equal(s['6-12 months'], 100000);
    assert.equal(s['12-24 months'], 200000);
    assert.equal(s['24+ months'], 436857);
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 836857) < 1e-6, 'bucket totals must sum to exactly the unfunded amount');
  });

  test('never needs more than what is actually left unfunded, even early', () => {
    // 90% already called — only $50k of the $500k commitment remains unfunded.
    const s = capitalCallSchedule(500000, 50000);
    assert.equal(s['0-6 months'], 50000);
    assert.equal(s['6-12 months'], 0);
    assert.equal(s['12-24 months'], 0);
    assert.equal(s['24+ months'], 0);
  });

  test('a fully-called commitment needs nothing', () => {
    const s = capitalCallSchedule(500000, 0);
    LIQUIDITY_BUCKETS.forEach((b) => assert.equal(s[b], 0));
  });
});

describe('unfundedCallScheduleCAD', () => {
  test('aggregates multiple positions per bucket, converting non-CAD commitments', () => {
    const port = { unfunded: [
      { commitment: 1000000, unfunded: 836857, currency: 'CAD' },
      { commitment: 500000, unfunded: 50000, currency: 'CAD' },
    ] };
    const totals = unfundedCallScheduleCAD(port);
    assert.equal(totals['0-6 months'], 150000);
    assert.equal(totals['6-12 months'], 100000);
    assert.equal(totals['12-24 months'], 200000);
    assert.equal(totals['24+ months'], 436857);
  });
});

describe('incomeByBucketCAD', () => {
  test('splits registered from freely-available income, weighted 0.5/0.5/1/1 years', () => {
    const income = { positions: [
      { annualDistribution: 100000, currency: 'CAD', isRegistered: false },
      { annualDistribution: 20000, currency: 'CAD', isRegistered: true },
    ] };
    const { available, registered } = incomeByBucketCAD(income);
    assert.equal(available['0-6 months'], 50000);
    assert.equal(available['6-12 months'], 50000);
    assert.equal(available['12-24 months'], 100000);
    assert.equal(available['24+ months'], 100000);
    assert.equal(registered['0-6 months'], 10000);
    assert.equal(registered['12-24 months'], 20000);
  });
});

describe('computeLiquidityPlan', () => {
  const port = {
    liquidityTiers: [
      { tier: 'Cash', items: [{ name: 'cash', amount: 1000000, currency: 'CAD' }] },
      { tier: 'Highly Liquid', items: [{ name: 'etf', amount: 2000000, currency: 'CAD' }] },
      { tier: 'Medium Liquidity', items: [] },
      { tier: 'Low Liquidity', items: [] },
    ],
    unfunded: [{ commitment: 1000000, unfunded: 836857, currency: 'CAD' }],
  };

  test('unlocks tiers cumulatively — cash only in bucket 1, plus highly liquid from bucket 2 on', () => {
    const plan = computeLiquidityPlan({ port, income: { positions: [] }, activities: [], newCommitmentCAD: 0 });
    assert.deepEqual(plan.rows[0].newlyUnlockedTiers, ['Cash']);
    assert.equal(plan.rows[0].cumSources, 1000000);
    assert.deepEqual(plan.rows[1].newlyUnlockedTiers, ['Highly Liquid']);
    assert.equal(plan.rows[1].cumSources, 3000000);
    // Nothing new unlocked in buckets 3/4 for this fixture (no Medium/Low holdings).
    assert.equal(plan.rows[2].tierSourceThisBucket, 0);
    assert.equal(plan.rows[3].tierSourceThisBucket, 0);
  });

  test('a new commitment under review adds to cumulative uses on top of the existing book', () => {
    const withoutNew = computeLiquidityPlan({ port, income: { positions: [] }, activities: [], newCommitmentCAD: 0 });
    const withNew = computeLiquidityPlan({ port, income: { positions: [] }, activities: [], newCommitmentCAD: 500000 });
    // New commitment's own 10% first-bucket call should be fully unfunded (it's brand new).
    assert.equal(withNew.rows[0].newCallThisBucket, 50000);
    assert.ok(withNew.rows[0].cumUses > withoutNew.rows[0].cumUses);
    assert.equal(withNew.rows[0].cumUses - withoutNew.rows[0].cumUses, 50000);
  });

  test('a planned outflow tagged with a liquidity category reduces that tier\'s available source', () => {
    const activities = [{ amount: 400000, currency: 'CAD', decreaseClass: 'Cash', increaseClass: null, status: 'Considering', timing: 'Uncertain' }];
    const plan = computeLiquidityPlan({ port, income: { positions: [] }, activities, newCommitmentCAD: 0 });
    assert.equal(plan.rows[0].cumSources, 600000);
  });

  test('flags when no liquidity tier data has been uploaded yet', () => {
    const empty = computeLiquidityPlan({ port: { unfunded: [] }, income: { positions: [] }, activities: [], newCommitmentCAD: 0 });
    assert.equal(empty.hasLiquidityData, false);
  });
});
