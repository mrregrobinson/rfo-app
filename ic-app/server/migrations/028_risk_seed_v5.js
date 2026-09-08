// Seeds the Risk Management register from the reconciled v5 content in
// server/risk-seed-data.js (see that file's header for the source docs and the
// spreadsheet/notes reconciliation). No-ops once risk_categories has rows, so it is safe
// on every boot — matching the guard style of import-tasks.js and the expenditure seed.
const crypto = require('node:crypto');
const { DOMAINS, SCALE, CATEGORIES, EFFECTIVE_DATE, SEED_ASSESSOR_ID } = require('../risk-seed-data');

module.exports = function (db) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM risk_categories').get().n;
  if (existing > 0) return;

  // If the seed assessor id isn't present (fresh/renamed users table), fall back to any
  // FO admin, then any user — the baseline assessment needs a valid assessed_by.
  const assessor =
    db.prepare('SELECT id FROM users WHERE id = ?').get(SEED_ASSESSOR_ID)?.id ||
    db.prepare('SELECT id FROM users WHERE is_fo_admin = 1 ORDER BY id LIMIT 1').get()?.id ||
    db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id;
  if (!assessor) {
    console.warn('028_risk_seed_v5: no users to attribute the baseline assessment to — skipping seed.');
    return;
  }

  const insDomain = db.prepare('INSERT INTO risk_domains (id, name, sort_order) VALUES (?, ?, ?)');
  for (const d of DOMAINS) insDomain.run(d.id, d.name, d.sort_order);

  const insScale = db.prepare('INSERT INTO risk_scale (kind, score, label, detail) VALUES (?, ?, ?, ?)');
  for (const s of SCALE) insScale.run(s.kind, s.score, s.label, s.detail);

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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, NULL, 'Seeded from Enterprise Risk Register v5 (effective June 2026).')`
  );

  CATEGORIES.forEach((c, ci) => {
    insCat.run({
      id: c.id, domainId: c.domainId, number: c.number, title: c.title,
      description: c.description, accountable: c.accountable, notes: c.note, sortOrder: ci + 1,
    });
    c.mitigations.forEach((text, mi) => {
      insMit.run(crypto.randomUUID(), c.id, text, mi + 1, EFFECTIVE_DATE, EFFECTIVE_DATE);
    });
    c.actions.forEach((a) => {
      insAct.run(crypto.randomUUID(), c.id, a.title, a.priority, a.ownerText || '', a.due || null, a.status || 'open', assessor, EFFECTIVE_DATE, EFFECTIVE_DATE);
    });
    insAssess.run(
      crypto.randomUUID(), c.id, EFFECTIVE_DATE, assessor,
      c.inherent[0], c.inherent[1], c.residual[0], c.residual[1], c.status, c.nextReview || null
    );
  });

  console.log(`028_risk_seed_v5: seeded ${DOMAINS.length} domains, ${CATEGORIES.length} risk categories, scale, mitigations, actions and baseline assessments.`);
};
