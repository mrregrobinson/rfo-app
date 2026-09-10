const crypto = require('node:crypto');
const db = require('./db');
const { hashSecret } = require('./auth');
const { DEFAULT_EXCLUSION_RULES } = require('./expenditure-defaults');
const riskSeed = require('./risk-seed-data');
const maturitySeed = require('./maturity-seed-data');

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
    // 'unknown' carries role: 'unknown' — see migration 025's header comment for why
    // the Unknown/Transfers buckets are identified by this role column rather than by
    // matching their (freely renameable) display name.
    const STARTER_CATEGORIES = [
      ['groceries', 'Groceries'], ['dining', 'Dining & Takeout'], ['utilities', 'Utilities'],
      ['housing', 'Housing (Mortgage/Rent/Property Tax)'], ['home-maintenance', 'Home Maintenance & Landscaping'],
      ['insurance', 'Insurance'], ['healthcare', 'Healthcare & Medical'], ['transportation', 'Transportation & Auto'],
      ['travel', 'Travel'], ['entertainment', 'Entertainment & Subscriptions'], ['shopping', 'Shopping & Retail'],
      ['personal-care', 'Personal Care'], ['professional-services', 'Professional Services'],
      ['gifts-donations', 'Gifts & Donations'], ['kids-family', 'Kids & Family'], ['pets', 'Pets'],
      ['bank-fees', 'Bank/Card Fees'], ['taxes', 'Taxes'], ['unknown', 'Miscellaneous/Unknown', 'unknown'],
    ];
    STARTER_CATEGORIES.forEach(([slug, name, role], i) => {
      db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order, role) VALUES (?, ?, ?, 1, ?, ?)').run(`${ledgerId}-${slug}`, ledgerId, name, i, role || null);
    });
    // Transfers are tracked (every excluded item is tagged is_transfer and kept, per the
    // build spec) but not counted as expenditure — is_expenditure=0 keeps it out of
    // spending totals while still selectable as a category for anything not auto-detected.
    db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order, role) VALUES (?, ?, ?, 0, ?, ?)').run(`${ledgerId}-transfers`, ledgerId, 'Transfers', STARTER_CATEGORIES.length, 'transfers');
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

  seedRiskRegister();
  seedMaturity();
}

// Enterprise Risk Register — initial content (RFO_Risk_App_BuildSpec_v1 §5.7). Seeded
// here — after the
// users above exist — rather than in a migration: migrations run at db.js require time,
// before ensureSeeded() has created anyone, so a migration-time seed on a fresh install
// would find no user to attribute the baseline assessment to and skip permanently. Same
// reasoning as the Household Expenditures ledger seed above. Idempotent: no-ops once
// risk_categories has rows.
function seedRiskRegister() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM risk_categories').get().n;
  if (existing > 0) return;

  const assessor =
    db.prepare('SELECT id FROM users WHERE id = ?').get(riskSeed.SEED_ASSESSOR_ID)?.id ||
    db.prepare('SELECT id FROM users WHERE is_fo_admin = 1 ORDER BY id LIMIT 1').get()?.id ||
    db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id;
  if (!assessor) {
    console.warn('seedRiskRegister: no users yet — skipping (will retry next boot).');
    return;
  }

  const insDomain = db.prepare('INSERT INTO risk_domains (id, name, sort_order) VALUES (?, ?, ?)');
  for (const d of riskSeed.DOMAINS) insDomain.run(d.id, d.name, d.sort_order);

  const insScale = db.prepare('INSERT INTO risk_scale (kind, score, label, detail) VALUES (?, ?, ?, ?)');
  for (const s of riskSeed.SCALE) insScale.run(s.kind, s.score, s.label, s.detail);

  const insCat = db.prepare(
    `INSERT INTO risk_categories (id, domain_id, number, title, description, accountable, notes, sort_order, is_active)
     VALUES (@id, @domainId, @number, @title, @description, @accountable, @notes, @sortOrder, 1)`
  );
  const insMit = db.prepare(
    `INSERT INTO risk_mitigations (id, category_id, text, in_place, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  );
  const insAct = db.prepare(
    `INSERT INTO risk_actions (id, category_id, title, detail, priority, owner_text, due_quarter, status, task_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, NULL, ?, ?, ?)`
  );
  const insAssess = db.prepare(
    `INSERT INTO risk_assessments (id, category_id, assessed_at, assessed_by, inherent_prob, inherent_impact, residual_prob, residual_impact, status, rationale, next_review, external_probability_id, supersedes_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, NULL, 'Initial assessment from the Enterprise Risk Register (effective June 2026).')`
  );

  riskSeed.CATEGORIES.forEach((c, ci) => {
    insCat.run({
      id: c.id, domainId: c.domainId, number: c.number, title: c.title,
      description: c.description, accountable: c.accountable, notes: c.note, sortOrder: ci + 1,
    });
    c.mitigations.forEach((text, mi) => {
      insMit.run(crypto.randomUUID(), c.id, text, mi + 1, riskSeed.EFFECTIVE_DATE, riskSeed.EFFECTIVE_DATE);
    });
    c.actions.forEach((a) => {
      insAct.run(crypto.randomUUID(), c.id, a.title, a.priority, a.ownerText || '', a.due || null, a.status || 'open', assessor, riskSeed.EFFECTIVE_DATE, riskSeed.EFFECTIVE_DATE);
    });
    insAssess.run(
      crypto.randomUUID(), c.id, riskSeed.EFFECTIVE_DATE, assessor,
      c.inherent[0], c.inherent[1], c.residual[0], c.residual[1], c.status, c.nextReview || null
    );
  });

  console.log(`Seeded Enterprise Risk Register: ${riskSeed.DOMAINS.length} domains, ${riskSeed.CATEGORIES.length} risk categories, scale, mitigations, actions and baseline assessments.`);
}

// Maturity Assessment — initial content (RFO_Maturity_App_BuildSpec_v1 §5.7). Seeded here
// (after the users above exist) rather than in migration 033: the reference round's
// member scores need a real user to attribute to, and migrations run before ensureSeeded()
// creates anyone. Idempotent: no-ops once maturity_services has rows.
function seedMaturity() {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM maturity_services').get().n;
  if (existing > 0) return;

  const actor =
    db.prepare('SELECT id FROM users WHERE id = ?').get(maturitySeed.SEED_ACTOR_ID)?.id ||
    db.prepare('SELECT id FROM users WHERE is_fo_admin = 1 ORDER BY id LIMIT 1').get()?.id ||
    db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id;
  if (!actor) {
    console.warn('seedMaturity: no users yet — skipping (will retry next boot).');
    return;
  }

  const now = new Date().toISOString();
  const eff = maturitySeed.REFERENCE_ROUND.effectiveDate;

  // Migration 033 backfills maturity_role from is_fo_admin, but on a fresh install that
  // migration runs before any user exists (same limitation as risk_role). Re-assert here,
  // now that the users exist: the FO admins (Reg, Sheri-Dawn) are Maturity admins; Ross
  // and Lucas are members (self-assess only). Deliberately NOT keying off the legacy
  // is_admin flag — on some databases it is set wider than intended.
  db.prepare("UPDATE users SET maturity_role = 'admin' WHERE is_fo_admin = 1").run();
  db.prepare("UPDATE users SET maturity_role = 'admin' WHERE id IN ('reg', 'sd')").run();
  db.prepare("UPDATE users SET maturity_role = 'member' WHERE id IN ('ross', 'lucas')").run();

  const insGroup = db.prepare('INSERT INTO maturity_service_groups (id, name, sort_order) VALUES (?, ?, ?)');
  for (const g of maturitySeed.GROUPS) insGroup.run(g.id, g.name, g.sort_order);

  const insLabel = db.prepare('INSERT INTO maturity_level_labels (level, name, blurb) VALUES (?, ?, ?)');
  for (const l of maturitySeed.LEVEL_LABELS) insLabel.run(l.level, l.name, l.blurb);

  const insSvc = db.prepare(
    'INSERT INTO maturity_services (id, group_id, number, name, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
  );
  const insDesc = db.prepare(
    'INSERT INTO maturity_level_descriptors (id, service_id, level, text, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insQ = db.prepare(
    'INSERT INTO maturity_questions (id, service_id, prompt, help_text, response_kind, weight, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
  );
  maturitySeed.SERVICES.forEach((s, si) => {
    insSvc.run(s.id, s.groupId, s.number, s.name, s.description || '', si + 1);
    s.levels.forEach((text, li) => {
      insDesc.run(crypto.randomUUID(), s.id, li + 1, text, eff, actor);
    });
    maturitySeed.questionsForService(s).forEach((q, qi) => {
      insQ.run(crypto.randomUUID(), s.id, q.prompt, q.help_text || '', q.response_kind, q.weight || 1, qi + 1);
    });
  });

  // The 7-level consciousness scale (used per service, Option C — migration 034).
  const insCcLevel = db.prepare('INSERT INTO maturity_cc_levels (level, name, tagline, description) VALUES (?, ?, ?, ?)');
  for (const l of maturitySeed.CC_LEVELS) insCcLevel.run(l.level, l.name, l.tagline, l.description);

  // The reference round — closed, no benchmarks, is_anchor = 0.
  const ref = maturitySeed.REFERENCE_ROUND;
  db.prepare(
    `INSERT INTO maturity_rounds (id, label, status, period_start, period_end, opened_at, opened_by, closed_at, closed_by, notes, ladder_json, carried_from, is_anchor, synthesis_json, created_at)
     VALUES (?, ?, 'closed', NULL, ?, ?, ?, ?, ?, ?, '{}', NULL, 0, NULL, ?)`
  ).run(
    ref.id, ref.label, eff, eff, actor, eff, actor,
    'Seeded from Appendix B - Maturity Scorecard.xlsx. Reference only — not the trend anchor; the first in-app cycle becomes the anchor.',
    now
  );

  const insScore = db.prepare(
    `INSERT INTO maturity_service_scores (id, round_id, service_id, user_id, level, computed_level, method, rationale, submitted, submitted_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'direct', '', 1, ?)`
  );
  for (const [serviceId, byUser] of Object.entries(ref.scores)) {
    for (const [userId, level] of Object.entries(byUser)) {
      insScore.run(crypto.randomUUID(), ref.id, serviceId, userId, level, eff);
    }
  }

  console.log(
    `Seeded Maturity Assessment: ${maturitySeed.GROUPS.length} categories, ${maturitySeed.SERVICES.length} services, ` +
    `${maturitySeed.SERVICES.length * 5} level descriptors, ${maturitySeed.CC_LEVELS.length}-level consciousness scale, ` +
    `and the "${ref.label}" reference round (${Object.keys(ref.scores).length} services scored, ${ref.notAssessed.length} not assessed).`
  );
}

module.exports = { ensureSeeded, issueSetupCode, IC_MEMBERS };
