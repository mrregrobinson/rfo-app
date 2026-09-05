const crypto = require('node:crypto');
const db = require('./db');
const { hashSecret } = require('./auth');
const { DEFAULT_EXCLUSION_RULES } = require('./expenditure-defaults');

const IC_MEMBERS = [
  { id: 'reg', name: 'Reg Robinson', role: 'Required', initials: 'RR', color: '#1B2A4A', isAdmin: true },
  { id: 'sd', name: 'Sheri-Dawn Robinson', role: 'Required', initials: 'SD', color: '#2A7D7B', isAdmin: false },
  { id: 'ross', name: 'Ross Robinson', role: 'Required', initials: 'ROS', color: '#C9A84C', isAdmin: false },
  { id: 'lucas', name: 'Lucas Robinson', role: 'Optional', initials: 'LR', color: '#7C3AED', isAdmin: false },
];

const ARCTOS_PQ_DATA = {
  thesisRating: 5,
  thesisSummary: 'Arctos has proprietary deal flow via longstanding league relationships — no generalist PE manager can replicate this sourcing network. The strategy offers inflation-protected, fan-driven revenue with low correlation to public markets.',
  hasTrackRecord: true,
  trackRecordDetail: 'Fund I: 14.2% net IRR; Fund II tracking 12.8% net IRR as of Q4-2024.',
  returnTarget: '12–16% net IRR',
  teamSummary: '12-person team; avg 16 years in sports & media investing; no senior departures since Fund I close.',
  downsideScenarios: 'PQ flags franchise valuations as the primary risk: a broad-based correction in sports team valuations (currently at record multiples) would compress marks across the portfolio. Secondary risks include league-imposed restrictions on transfers/governance limiting exit flexibility, and concentration in a still-young manager (KKR ownership since 2023) with limited realized track record beyond Fund I. PQ models a downside case of 0–4% net IRR in a valuation-reset scenario, versus the 12–16% base case.',
  esgProgramme: 'Developing',
  esgApproach: 'Opportunistic',
  esgNote: 'No formal ESG policy. League regulations (NFL, NBA, NHL) impose material behavioural constraints on all fund employees and investments.',
  oddRatings: { governance: 'Medium', compliance: 'Low', operations: 'Low', alignment: 'Low', reporting: 'Low' },
  oddGovernanceNote: 'KKR acquired Arctos in 2023. Management continuity agreements are in place and the investment team operates independently. PQ has monitored this transition and is satisfied.',
  feesSummary: '1.5% mgmt fee, 20% carry, American-style waterfall with escrow provision — below norm for PE',
  termsSummary: 'No LPAC seat at this commitment size. Co-invest rights on best-efforts basis. Day-1 key-person clause covering 3 founding partners.',
  lpRightsNote: 'LPAC access would require USD 5M+ commitment. Co-invest rights are informal at this size.',
  feesAboveNorm: false,
  feesBelowNorm: true,
  isOffshore: false,
  vehicleType: 'Delaware LP',
  mltaRequired: true,
};

function randomSetupCode() {
  return String(crypto.randomInt(100000, 999999));
}

// Generates a fresh one-time setup code for a member, clearing any existing password/2FA.
// Used both for first-run seeding and for an admin resetting someone who lost their
// phone/password. Returns the plaintext code — the only time it's ever visible.
function issueSetupCode(userId) {
  const code = randomSetupCode();
  db.prepare(
    `UPDATE users SET setup_code_hash = ?, password_hash = NULL, totp_secret = NULL, totp_enabled = 0,
       failed_attempts = 0, locked_until = NULL WHERE id = ?`
  ).run(hashSecret(code), userId);
  return code;
}

function ensureSeeded() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const printed = [];
    for (const m of IC_MEMBERS) {
      const code = randomSetupCode();
      db.prepare(
        'INSERT INTO users (id, name, role, initials, color, is_admin, setup_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(m.id, m.name, m.role, m.initials, m.color, m.isAdmin ? 1 : 0, hashSecret(code));
      printed.push(`  ${m.name.padEnd(24)} id=${m.id.padEnd(6)} setup code=${code}`);
    }
    console.log('\n=== First run: generated one-time setup codes (save these — shown only once) ===');
    console.log(printed.join('\n'));
    console.log('Each member uses their code once to set a password and enable 2FA at /.');
    console.log('=================================================================================\n');
  }

  const oppCount = db.prepare('SELECT COUNT(*) AS n FROM opportunities').get().n;
  if (oppCount === 0) {
    const now = new Date().toISOString();
    const deadline = new Date(Date.now() + 5 * 86400000).toISOString();
    db.prepare(
      `INSERT INTO opportunities
        (id, title, asset_class, commitment, currency, deadline, additional_context, notify_lucas, created_at, initiated_by, status, pq_summary, pq_data, report, decision)
       VALUES (@id, @title, @assetClass, @commitment, @currency, @deadline, @additionalContext, @notifyLucas, @createdAt, @initiatedBy, @status, @pqSummary, @pqData, NULL, NULL)`
    ).run({
      id: 'opp1',
      title: 'Arctos Sports Partners Fund III',
      assetClass: 'Private Equity',
      commitment: 500000,
      currency: 'USD',
      deadline,
      additionalContext: '',
      notifyLucas: 1,
      createdAt: now,
      initiatedBy: 'reg',
      status: 'open',
      pqSummary: 'Minority ownership stakes in major North American and European professional sports franchises.',
      pqData: JSON.stringify(ARCTOS_PQ_DATA),
    });
    const rNow = new Date().toISOString();
    for (const m of IC_MEMBERS) {
      db.prepare(
        `INSERT INTO responses (opportunity_id, user_id, responses, recommendation, overall, follow_up, submitted, updated_at)
         VALUES (?, ?, '{}', NULL, '', '[]', 0, ?)`
      ).run('opp1', m.id, rNow);
    }
    console.log('Seeded sample opportunity: Arctos Sports Partners Fund III');
  }

  const activityCount = db.prepare('SELECT COUNT(*) AS n FROM activities').get().n;
  if (activityCount === 0) {
    const aNow = new Date().toISOString();
    const seedActivities = [
      {
        description: 'Lucas Robinson — house purchase',
        amount: 2000000,
        currency: 'CAD',
        decreaseClass: 'Cash',
        increaseClass: null,
        decreaseAssetClass: 'Cash',
        increaseAssetClass: null,
        impact: 'Withdrawal of cash and other investments to fund a house purchase — reduces capital available for new commitments.',
        status: 'Considering',
        timing: '6-12 months',
      },
      {
        description: 'R&R Keys Corporation — sale of Leader Building',
        amount: 600000,
        currency: 'CAD',
        decreaseClass: 'Low Liquidity',
        increaseClass: 'Cash',
        decreaseAssetClass: 'Real Assets',
        increaseAssetClass: 'Cash',
        impact: 'Sale of the Leader Building property (currently held under Real Assets) — proceeds would convert to cash; does not change total portfolio value.',
        status: 'Considering',
        timing: 'Uncertain',
      },
      {
        description: 'Ross Robinson — investment into Rewire Collections',
        amount: 1000000,
        currency: 'CAD',
        decreaseClass: 'Cash',
        increaseClass: null,
        decreaseAssetClass: 'Cash',
        increaseAssetClass: null,
        impact: 'Capital allocation into Ross\'s company (Rewire Collections, not tracked by PQ) — reduces investable RFO assets.',
        status: 'Considering',
        timing: '12-24 months',
      },
    ];
    for (const a of seedActivities) {
      db.prepare(
        `INSERT INTO activities (id, description, amount, currency, decrease_class, increase_class, decrease_asset_class, increase_asset_class, impact, status, timing, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), a.description, a.amount, a.currency, a.decreaseClass, a.increaseClass, a.decreaseAssetClass, a.increaseAssetClass, a.impact, a.status, a.timing, 'reg', aNow, aNow);
    }
    console.log('Seeded 3 sample family planning activities');
  }

  // Household Expenditures: seeds exactly one ledger for Reg and Sheri-Dawn (the only
  // two users of this app for now), with a starter category list — kept under ~20
  // categories per the build spec, so the "Miscellaneous/Unknown" bucket stays
  // meaningful. A future Ross- and/or Lucas-only ledger is just another row in
  // expenditure_ledgers with its own members and its own categories — no schema change
  // needed, and no visibility into this one. Seeded here (after the users above exist),
  // not in migration 023's schema-only migration — see that file's header comment.
  const ledgerCount = db.prepare('SELECT COUNT(*) AS n FROM expenditure_ledgers').get().n;
  if (ledgerCount === 0) {
    const eNow = new Date().toISOString();
    const ledgerId = 'reg-sd-household';
    db.prepare('INSERT INTO expenditure_ledgers (id, name, created_at) VALUES (?, ?, ?)').run(ledgerId, 'Reg & Sheri-Dawn Household', eNow);
    for (const userId of ['reg', 'sd']) {
      db.prepare('INSERT OR IGNORE INTO expenditure_ledger_members (ledger_id, user_id, role) VALUES (?, ?, ?)').run(ledgerId, userId, 'admin');
    }
    const STARTER_CATEGORIES = [
      ['groceries', 'Groceries'], ['dining', 'Dining & Takeout'], ['utilities', 'Utilities'],
      ['housing', 'Housing (Mortgage/Rent/Property Tax)'], ['home-maintenance', 'Home Maintenance & Landscaping'],
      ['insurance', 'Insurance'], ['healthcare', 'Healthcare & Medical'], ['transportation', 'Transportation & Auto'],
      ['travel', 'Travel'], ['entertainment', 'Entertainment & Subscriptions'], ['shopping', 'Shopping & Retail'],
      ['personal-care', 'Personal Care'], ['professional-services', 'Professional Services'],
      ['gifts-donations', 'Gifts & Donations'], ['kids-family', 'Kids & Family'], ['pets', 'Pets'],
      ['bank-fees', 'Bank/Card Fees'], ['taxes', 'Taxes'], ['unknown', 'Miscellaneous/Unknown'],
    ];
    STARTER_CATEGORIES.forEach(([slug, name], i) => {
      db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 1, ?)').run(`${ledgerId}-${slug}`, ledgerId, name, i);
    });
    // Transfers are tracked (every excluded item is tagged is_transfer and kept, per the
    // build spec) but not counted as expenditure — is_expenditure=0 keeps it out of
    // spending totals while still selectable as a category for anything not auto-detected.
    db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 0, ?)').run(`${ledgerId}-transfers`, ledgerId, 'Transfers', STARTER_CATEGORIES.length);
    // Starter transfer/income exclusion rules — same canonical list migration 024 backfills
    // onto a ledger that already existed before this feature did; a brand-new ledger (this
    // one, on a fresh install) is seeded here instead, since migrations run before this
    // function ever gets a chance to create one.
    DEFAULT_EXCLUSION_RULES.forEach((rule, i) => {
      db.prepare(
        `INSERT INTO expenditure_exclusion_rules (id, ledger_id, pattern, match_type, direction, account_type, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(`${ledgerId}-excl-${i}`, ledgerId, rule.pattern, rule.matchType, rule.direction, rule.accountType, eNow);
    });
    console.log('Seeded Household Expenditures ledger for Reg & Sheri-Dawn');
  }
}

module.exports = { ensureSeeded, issueSetupCode, IC_MEMBERS };
