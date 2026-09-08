// Risk Management module routes — mounted onto the main app from index.js, same pattern
// as tasks.js / meetings.js / expenditure.js. See RFO_Risk_App_BuildSpec_v1.
//
// Permission model (§4): risk_role is admin / member / viewer, independent of the other
// per-app role columns. An FO admin is always also a Risk admin. Unlike the other three
// apps, viewer is the column default — the whole register is readable by anyone with any
// role, but every write (assessment, event, action, taxonomy) is member+ or admin.
//
// Task List integration (§6.5): a risk action is "promoted" to a real row in the
// existing tasks table under the seeded `risk-management` category, and linked back via
// risk_actions.task_id — exactly like meeting_action_items.task_id. Once linked, the
// task row is authoritative for status/owner/target and the action reads through to it.
const crypto = require('node:crypto');
const { requireAuth } = require('./auth');
const claude = require('./claude');
const mailer = require('./mailer');
const { logApiUsage } = require('./usage');
const { contentRow, paragraph, emailShell } = require('./email-template');
const { buildRiskReportPdf } = require('./risk-report');
const { IPS_CONTEXT } = require('./risk-seed-data');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';
const RISK_TASK_CATEGORY_ID = 'risk-management'; // seeded in migration 013
const REVIEW_SETTING_KEYS = ['risk_review_enabled', 'risk_review_cadence', 'risk_review_day_of_week', 'risk_review_hour_local', 'risk_review_timezone'];

// P×I scoring, fixed in code (not user-editable) — mirrored verbatim in public/risk.html
// and server/risk-report.js. Bands: 1–5 Low, 6–8 Medium, 9–16 High.
function scoreOf(prob, impact) {
  return (Number(prob) || 0) * (Number(impact) || 0);
}
function bandOf(score) {
  if (score <= 5) return 'Low';
  if (score <= 8) return 'Medium';
  return 'High';
}
const PRIORITIES = ['Immediate', 'Active', 'Monitor'];
const EVENT_SEVERITIES = ['Near miss', 'Minor', 'Moderate', 'Significant', 'Severe'];
const STATUS_VALUES = ['Active — Well Managed', 'Active — Partially Mitigated', 'In Progress', 'INCOMPLETE — Action Required'];

module.exports = function registerRiskRoutes(app, { db, logAudit }) {
  function myRoles(userId) {
    const row = db.prepare('SELECT is_fo_admin, risk_role, tasks_role FROM users WHERE id = ?').get(userId);
    if (!row) return { isFoAdmin: false, riskAdmin: false, riskMember: false, tasksAdmin: false, tasksMember: false };
    const isFoAdmin = !!row.is_fo_admin;
    return {
      isFoAdmin,
      riskAdmin: isFoAdmin || row.risk_role === 'admin',
      riskMember: isFoAdmin || row.risk_role === 'admin' || row.risk_role === 'member',
      tasksAdmin: isFoAdmin || row.tasks_role === 'admin',
      tasksMember: isFoAdmin || row.tasks_role === 'admin' || row.tasks_role === 'member',
    };
  }
  const requireMember = (req, res) => {
    if (!myRoles(req.session.userId).riskMember) {
      res.status(403).json({ error: 'This action needs Risk member or admin access.' });
      return false;
    }
    return true;
  };
  const requireAdmin = (req, res) => {
    if (!myRoles(req.session.userId).riskAdmin) {
      res.status(403).json({ error: 'Risk admin only.' });
      return false;
    }
    return true;
  };

  // ---- row -> json ----

  function assessmentRowToJson(r) {
    if (!r) return null;
    return {
      id: r.id, categoryId: r.category_id, assessedAt: r.assessed_at, assessedBy: r.assessed_by,
      assessedByName: userName(r.assessed_by),
      inherentProb: r.inherent_prob, inherentImpact: r.inherent_impact,
      inherentScore: scoreOf(r.inherent_prob, r.inherent_impact), inherentBand: bandOf(scoreOf(r.inherent_prob, r.inherent_impact)),
      residualProb: r.residual_prob, residualImpact: r.residual_impact,
      residualScore: scoreOf(r.residual_prob, r.residual_impact), residualBand: bandOf(scoreOf(r.residual_prob, r.residual_impact)),
      status: r.status, rationale: r.rationale, nextReview: r.next_review,
      externalProbabilityId: r.external_probability_id, supersedesId: r.supersedes_id, note: r.note,
    };
  }
  function mitigationRowToJson(r) {
    return { id: r.id, categoryId: r.category_id, text: r.text, inPlace: !!r.in_place, sortOrder: r.sort_order, updatedAt: r.updated_at };
  }
  function taskInfo(taskId) {
    if (!taskId) return null;
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!t) return { deleted: true };
    const assigneeRows = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(t.id);
    const assignedToAll = assigneeRows.some((a) => a.user_id === null);
    return {
      deleted: false, id: t.id, title: t.title, status: t.status, priority: t.priority,
      targetQuarter: t.target_quarter, targetDate: t.target_date, completedAt: t.completed_at,
      assignedToAll,
      assigneeNames: assignedToAll ? ['All'] : assigneeRows.map((a) => userName(a.user_id)).filter(Boolean),
      categoryId: t.category_id,
    };
  }
  function actionRowToJson(r) {
    const task = taskInfo(r.task_id);
    // Once linked, the task row is authoritative for status. deleted link -> fall back.
    let effectiveStatus = r.status;
    if (r.task_id && task && !task.deleted) effectiveStatus = task.status === 'done' ? 'done' : 'in_progress';
    return {
      id: r.id, categoryId: r.category_id, title: r.title, detail: r.detail,
      priority: r.priority, ownerText: r.owner_text, dueQuarter: r.due_quarter,
      status: r.status, effectiveStatus, taskId: r.task_id, task,
      linkedTaskDeleted: !!(r.task_id && task && task.deleted),
      createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  function eventRowToJson(r) {
    return {
      id: r.id, categoryId: r.category_id, occurredOn: r.occurred_on, title: r.title,
      description: r.description, severity: r.severity, financialImpactCad: r.financial_impact_cad,
      status: r.status, responseNotes: r.response_notes, loggedBy: r.logged_by, loggedByName: userName(r.logged_by),
      createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at,
    };
  }
  function lookupRowToJson(r) {
    if (!r) return null;
    let sources = [];
    try { sources = JSON.parse(r.sources || '[]'); } catch { sources = []; }
    return {
      id: r.id, categoryId: r.category_id, query: r.query, estimateText: r.estimate_text,
      probabilityLow: r.probability_low, probabilityHigh: r.probability_high, mappedScore: r.mapped_score,
      rationale: r.rationale, caveats: r.caveats, sources, model: r.model,
      searchedBy: r.searched_by, searchedByName: userName(r.searched_by), searchedAt: r.searched_at,
    };
  }
  const _nameCache = new Map();
  function userName(id) {
    if (!id) return null;
    if (_nameCache.has(id)) return _nameCache.get(id);
    const row = db.prepare('SELECT name FROM users WHERE id = ?').get(id);
    const n = row ? row.name : null;
    _nameCache.set(id, n);
    return n;
  }

  function latestAssessment(categoryId, atOrBefore) {
    if (atOrBefore) {
      return db.prepare(
        'SELECT * FROM risk_assessments WHERE category_id = ? AND assessed_at <= ? ORDER BY assessed_at DESC, rowid DESC LIMIT 1'
      ).get(categoryId, atOrBefore);
    }
    return db.prepare(
      'SELECT * FROM risk_assessments WHERE category_id = ? ORDER BY assessed_at DESC, rowid DESC LIMIT 1'
    ).get(categoryId);
  }
  function actionCounts(categoryId) {
    const rows = db.prepare('SELECT * FROM risk_actions WHERE category_id = ?').all(categoryId).map(actionRowToJson);
    const open = rows.filter((a) => a.effectiveStatus !== 'done');
    return {
      total: rows.length,
      open: open.length,
      immediate: open.filter((a) => a.priority === 'Immediate').length,
      active: open.filter((a) => a.priority === 'Active').length,
      monitor: open.filter((a) => a.priority === 'Monitor').length,
      incomplete: open.filter((a) => a.status === 'incomplete').length,
    };
  }
  function events12mo(categoryId) {
    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return db.prepare('SELECT COUNT(*) AS n FROM risk_events WHERE category_id = ? AND occurred_on >= ?').get(categoryId, cutoff).n;
  }
  function getSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  }

  // ---- overview / register ----

  app.get('/api/risk/overview', requireAuth, (req, res) => {
    const domains = db.prepare('SELECT * FROM risk_domains ORDER BY sort_order').all()
      .map((d) => ({ id: d.id, name: d.name, sortOrder: d.sort_order }));
    const cats = db.prepare('SELECT * FROM risk_categories ORDER BY sort_order').all().map((c) => ({
      id: c.id, domainId: c.domain_id, number: c.number, title: c.title, description: c.description,
      accountable: c.accountable, notes: c.notes, sortOrder: c.sort_order, isActive: !!c.is_active,
      latestAssessment: assessmentRowToJson(latestAssessment(c.id)),
      actionCounts: actionCounts(c.id),
      events12mo: events12mo(c.id),
    }));
    const scale = db.prepare('SELECT * FROM risk_scale ORDER BY kind, score').all()
      .map((s) => ({ kind: s.kind, score: s.score, label: s.label, detail: s.detail }));
    res.json({ domains, categories: cats, scale, ipsContext: IPS_CONTEXT, generatedAt: new Date().toISOString() });
  });

  app.get('/api/risk/categories/:id', requireAuth, (req, res) => {
    const c = db.prepare('SELECT * FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    const assessments = db.prepare('SELECT * FROM risk_assessments WHERE category_id = ? ORDER BY assessed_at ASC, rowid ASC').all(c.id).map(assessmentRowToJson);
    const mitigations = db.prepare('SELECT * FROM risk_mitigations WHERE category_id = ? ORDER BY sort_order, rowid').all(c.id).map(mitigationRowToJson);
    const actions = db.prepare('SELECT * FROM risk_actions WHERE category_id = ? ORDER BY created_at').all(c.id).map(actionRowToJson);
    const events = db.prepare('SELECT * FROM risk_events WHERE category_id = ? ORDER BY occurred_on DESC, rowid DESC').all(c.id).map(eventRowToJson);
    const lastLookup = lookupRowToJson(db.prepare('SELECT * FROM risk_probability_lookups WHERE category_id = ? ORDER BY searched_at DESC LIMIT 1').get(c.id));
    res.json({
      category: {
        id: c.id, domainId: c.domain_id, number: c.number, title: c.title, description: c.description,
        accountable: c.accountable, notes: c.notes, sortOrder: c.sort_order, isActive: !!c.is_active,
      },
      assessments, mitigations, actions, events, lastLookup,
    });
  });

  // ---- taxonomy (admin) ----

  app.put('/api/risk/domains/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const d = db.prepare('SELECT * FROM risk_domains WHERE id = ?').get(req.params.id);
    if (!d) return res.status(404).json({ error: 'Domain not found' });
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    db.prepare('UPDATE risk_domains SET name = ? WHERE id = ?').run(name, d.id);
    logAudit({ userId: req.session.userId, action: 'risk.taxonomy_changed', entityType: 'risk_domain', entityId: d.id, details: { name } });
    res.json({ id: d.id, name, sortOrder: d.sort_order });
  });

  app.post('/api/risk/categories', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const domain = db.prepare('SELECT id FROM risk_domains WHERE id = ?').get(b.domainId);
    if (!domain) return res.status(400).json({ error: 'Unknown domainId' });
    if (!b.title || !b.description) return res.status(400).json({ error: 'title and description are required' });
    const id = 'risk-' + crypto.randomUUID().slice(0, 8);
    const maxNum = db.prepare('SELECT MAX(number) AS m FROM risk_categories').get().m || 0;
    const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM risk_categories').get().m || 0;
    db.prepare(
      `INSERT INTO risk_categories (id, domain_id, number, title, description, accountable, notes, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(id, b.domainId, Number(b.number) || maxNum + 1, b.title.trim(), b.description.trim(), (b.accountable || '').trim(), (b.notes || '').trim(), maxSort + 1);
    logAudit({ userId: req.session.userId, action: 'risk.taxonomy_changed', entityType: 'risk_category', entityId: id, details: { created: b.title } });
    res.status(201).json({ id });
  });

  app.put('/api/risk/categories/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const c = db.prepare('SELECT * FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    const b = req.body || {};
    if (b.domainId && !db.prepare('SELECT id FROM risk_domains WHERE id = ?').get(b.domainId)) {
      return res.status(400).json({ error: 'Unknown domainId' });
    }
    db.prepare(
      `UPDATE risk_categories SET domain_id=@domainId, number=@number, title=@title, description=@description,
         accountable=@accountable, notes=@notes, sort_order=@sortOrder, is_active=@isActive WHERE id=@id`
    ).run({
      id: c.id,
      domainId: b.domainId || c.domain_id,
      number: b.number != null ? Number(b.number) : c.number,
      title: b.title != null ? String(b.title).trim() : c.title,
      description: b.description != null ? String(b.description).trim() : c.description,
      accountable: b.accountable != null ? String(b.accountable).trim() : c.accountable,
      notes: b.notes != null ? String(b.notes).trim() : c.notes,
      sortOrder: b.sortOrder != null ? Number(b.sortOrder) : c.sort_order,
      isActive: b.isActive != null ? (b.isActive ? 1 : 0) : c.is_active,
    });
    logAudit({ userId: req.session.userId, action: 'risk.taxonomy_changed', entityType: 'risk_category', entityId: c.id });
    res.json({ ok: true });
  });

  // Members can edit a risk's general notes without touching the rest of the taxonomy
  // (which stays admin-only via PUT /api/risk/categories/:id).
  app.put('/api/risk/categories/:id/notes', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const c = db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    const notes = String(req.body?.notes ?? '').trim();
    db.prepare('UPDATE risk_categories SET notes = ? WHERE id = ?').run(notes, c.id);
    logAudit({ userId: req.session.userId, action: 'risk.notes_updated', entityType: 'risk_category', entityId: c.id });
    res.json({ ok: true, notes });
  });

  app.delete('/api/risk/categories/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const c = db.prepare('SELECT * FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    // Soft-retire — keep assessments/events/actions for history and the profile trend.
    db.prepare('UPDATE risk_categories SET is_active = 0 WHERE id = ?').run(c.id);
    logAudit({ userId: req.session.userId, action: 'risk.taxonomy_changed', entityType: 'risk_category', entityId: c.id, details: { retired: c.title } });
    res.json({ ok: true, retired: true });
  });

  app.put('/api/risk/scale', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const rows = Array.isArray(req.body?.scale) ? req.body.scale : [];
    const upd = db.prepare('UPDATE risk_scale SET label = ?, detail = ? WHERE kind = ? AND score = ?');
    for (const s of rows) {
      if (!['probability', 'impact'].includes(s.kind) || ![1, 2, 3, 4].includes(Number(s.score))) continue;
      upd.run(String(s.label || '').trim(), String(s.detail || '').trim(), s.kind, Number(s.score));
    }
    logAudit({ userId: req.session.userId, action: 'risk.taxonomy_changed', entityType: 'risk_scale', entityId: 'scale' });
    res.json(db.prepare('SELECT * FROM risk_scale ORDER BY kind, score').all().map((s) => ({ kind: s.kind, score: s.score, label: s.label, detail: s.detail })));
  });

  // ---- assessments ----

  app.post('/api/risk/categories/:id/assessments', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const c = db.prepare('SELECT * FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    const b = req.body || {};
    const nums = ['inherentProb', 'inherentImpact', 'residualProb', 'residualImpact'];
    for (const k of nums) {
      if (![1, 2, 3, 4].includes(Number(b[k]))) return res.status(400).json({ error: `${k} must be 1–4` });
    }
    if (!STATUS_VALUES.includes(b.status)) return res.status(400).json({ error: 'status is not a recognised value' });
    let externalId = null;
    if (b.externalProbabilityId) {
      const lk = db.prepare('SELECT id FROM risk_probability_lookups WHERE id = ?').get(b.externalProbabilityId);
      if (lk) externalId = lk.id;
    }
    const prev = latestAssessment(c.id);
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO risk_assessments (id, category_id, assessed_at, assessed_by, inherent_prob, inherent_impact, residual_prob, residual_impact, status, rationale, next_review, external_probability_id, supersedes_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, c.id, new Date().toISOString(), req.session.userId,
      Number(b.inherentProb), Number(b.inherentImpact), Number(b.residualProb), Number(b.residualImpact),
      b.status, (b.rationale || '').trim(), (b.nextReview || '').trim() || null, externalId, prev ? prev.id : null, (b.note || '').trim()
    );
    logAudit({ userId: req.session.userId, action: 'risk.assessment_saved', entityType: 'risk_category', entityId: c.id, details: { residual: scoreOf(b.residualProb, b.residualImpact), status: b.status } });
    res.status(201).json(assessmentRowToJson(db.prepare('SELECT * FROM risk_assessments WHERE id = ?').get(id)));
  });

  // ---- mitigations ----

  app.post('/api/risk/categories/:id/mitigations', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const c = db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Risk category not found' });
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM risk_mitigations WHERE category_id = ?').get(c.id).m || 0;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO risk_mitigations (id, category_id, text, in_place, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, c.id, text, req.body?.inPlace === false ? 0 : 1, maxSort + 1, now, now);
    res.status(201).json(mitigationRowToJson(db.prepare('SELECT * FROM risk_mitigations WHERE id = ?').get(id)));
  });

  app.put('/api/risk/mitigations/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const m = db.prepare('SELECT * FROM risk_mitigations WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Mitigation not found' });
    const b = req.body || {};
    db.prepare('UPDATE risk_mitigations SET text = ?, in_place = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(
      b.text != null ? String(b.text).trim() : m.text,
      b.inPlace != null ? (b.inPlace ? 1 : 0) : m.in_place,
      b.sortOrder != null ? Number(b.sortOrder) : m.sort_order,
      new Date().toISOString(), m.id
    );
    res.json(mitigationRowToJson(db.prepare('SELECT * FROM risk_mitigations WHERE id = ?').get(m.id)));
  });

  app.delete('/api/risk/mitigations/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    db.prepare('DELETE FROM risk_mitigations WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // ---- actions ----

  app.get('/api/risk/actions', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM risk_actions ORDER BY created_at').all().map((r) => {
      const cat = db.prepare('SELECT number, title, domain_id FROM risk_categories WHERE id = ?').get(r.category_id);
      return { ...actionRowToJson(r), categoryNumber: cat?.number, categoryTitle: cat?.title, domainId: cat?.domain_id };
    });
    res.json(rows);
  });

  app.post('/api/risk/actions', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const c = db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(b.categoryId);
    if (!c) return res.status(400).json({ error: 'Unknown categoryId' });
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'Active';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO risk_actions (id, category_id, title, detail, priority, owner_text, due_quarter, status, task_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    ).run(id, b.categoryId, b.title.trim(), (b.detail || '').trim(), priority, (b.ownerText || '').trim(), (b.dueQuarter || '').trim() || null,
      ['open', 'in_progress', 'done', 'incomplete'].includes(b.status) ? b.status : 'open', req.session.userId, now, now);
    logAudit({ userId: req.session.userId, action: 'risk.action_created', entityType: 'risk_category', entityId: b.categoryId, details: { title: b.title } });
    res.status(201).json(actionRowToJson(db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(id)));
  });

  app.put('/api/risk/actions/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const a = db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Action not found' });
    const b = req.body || {};
    db.prepare(
      `UPDATE risk_actions SET title=@title, detail=@detail, priority=@priority, owner_text=@ownerText,
         due_quarter=@dueQuarter, status=@status, updated_at=@updatedAt WHERE id=@id`
    ).run({
      id: a.id,
      title: b.title != null ? String(b.title).trim() : a.title,
      detail: b.detail != null ? String(b.detail).trim() : a.detail,
      priority: PRIORITIES.includes(b.priority) ? b.priority : a.priority,
      ownerText: b.ownerText != null ? String(b.ownerText).trim() : a.owner_text,
      dueQuarter: b.dueQuarter !== undefined ? (String(b.dueQuarter).trim() || null) : a.due_quarter,
      status: ['open', 'in_progress', 'done', 'incomplete'].includes(b.status) ? b.status : a.status,
      updatedAt: new Date().toISOString(),
    });
    res.json(actionRowToJson(db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(a.id)));
  });

  app.delete('/api/risk/actions/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    // The linked Family Task List task (if any) is left in place — someone may be acting
    // on it already (same rule as meeting_action_items deletion).
    db.prepare('DELETE FROM risk_actions WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  // Promote a risk action to a real Family Task List task under the seeded
  // `risk-management` category, and link it back (risk_actions.task_id). Task mutation
  // stays under tasks_role (§6.5) — a Risk member who isn't a Task List member can't do
  // this. Mirrors server/meetings.js's family-action-item -> tasks insert.
  app.post('/api/risk/actions/:id/promote', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.riskMember) return res.status(403).json({ error: 'This action needs Risk member or admin access.' });
    if (!roles.tasksMember) return res.status(403).json({ error: 'Adding to the Family Task List needs Task List member or admin access.' });
    const a = db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Action not found' });
    if (a.task_id && db.prepare('SELECT id FROM tasks WHERE id = ?').get(a.task_id)) {
      return res.status(400).json({ error: 'This action is already linked to a task.' });
    }
    const cat = db.prepare('SELECT number, title FROM risk_categories WHERE id = ?').get(a.category_id);
    const b = req.body || {};
    const priority = ['high', 'medium', 'low'].includes(b.priority) ? b.priority : (a.priority === 'Immediate' ? 'high' : 'medium');
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const notes = `From Risk #${cat.number} — ${cat.title}.` + (a.detail ? ` ${a.detail}` : '');
    db.prepare(
      `INSERT INTO tasks (id, category_id, parent_task_id, title, priority, target_quarter, target_date, status, completed_at, notes, source_ref_id, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, 'open', NULL, ?, NULL, ?, ?, ?)`
    ).run(taskId, RISK_TASK_CATEGORY_ID, b.title?.trim() || a.title, priority, (b.targetQuarter || a.due_quarter || '').trim() || null, notes, req.session.userId, now, now);
    const assigneeIds = Array.isArray(b.assigneeIds) ? b.assigneeIds : [];
    if (b.assignedToAll) {
      db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, NULL)').run(taskId);
    } else if (assigneeIds.length) {
      for (const uid of assigneeIds) {
        if (db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) {
          db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, uid);
        }
      }
    }
    db.prepare('UPDATE risk_actions SET task_id = ?, updated_at = ? WHERE id = ?').run(taskId, now, a.id);
    logAudit({ userId: req.session.userId, action: 'risk.action_promoted_to_task', entityType: 'risk_action', entityId: a.id, details: { taskId } });
    logAudit({ userId: req.session.userId, action: 'task.created', entityType: 'task', entityId: taskId, details: { title: b.title?.trim() || a.title, fromRiskActionId: a.id } });
    res.json(actionRowToJson(db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(a.id)));
  });

  app.post('/api/risk/actions/:id/unlink', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const a = db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Action not found' });
    db.prepare('UPDATE risk_actions SET task_id = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), a.id);
    res.json(actionRowToJson(db.prepare('SELECT * FROM risk_actions WHERE id = ?').get(a.id)));
  });

  // Read-through view of the Family Task List's `risk-management` category, so the
  // Actions & Tasks tab can show and (with tasks_role) create tasks without leaving the
  // app. Create/edit go to the existing /api/tasks endpoints from the frontend.
  app.get('/api/risk/task-list', requireAuth, (req, res) => {
    const rows = db.prepare("SELECT * FROM tasks WHERE category_id = ? ORDER BY created_at").all(RISK_TASK_CATEGORY_ID);
    const linkedByTask = new Map(
      db.prepare('SELECT id, task_id, category_id FROM risk_actions WHERE task_id IS NOT NULL').all().map((r) => [r.task_id, r])
    );
    res.json(rows.map((t) => {
      const info = taskInfo(t.id);
      const link = linkedByTask.get(t.id);
      let riskCat = null;
      if (link) { const rc = db.prepare('SELECT number, title FROM risk_categories WHERE id = ?').get(link.category_id); riskCat = rc ? { number: rc.number, title: rc.title } : null; }
      return { ...info, notes: t.notes, createdAt: t.created_at, linkedRiskActionId: link ? link.id : null, linkedRiskCategory: riskCat };
    }));
  });

  // ---- events ----

  app.get('/api/risk/events', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM risk_events ORDER BY occurred_on DESC, rowid DESC').all().map((r) => {
      const cat = db.prepare('SELECT number, title, domain_id FROM risk_categories WHERE id = ?').get(r.category_id);
      return { ...eventRowToJson(r), categoryNumber: cat?.number, categoryTitle: cat?.title, domainId: cat?.domain_id };
    });
    res.json(rows);
  });

  app.post('/api/risk/events', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const c = db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(b.categoryId);
    if (!c) return res.status(400).json({ error: 'Unknown categoryId' });
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
    if (!b.occurredOn) return res.status(400).json({ error: 'occurredOn is required' });
    const severity = EVENT_SEVERITIES.includes(b.severity) ? b.severity : 'Minor';
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO risk_events (id, category_id, occurred_on, title, description, severity, financial_impact_cad, status, response_notes, logged_by, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(id, b.categoryId, String(b.occurredOn).slice(0, 10), b.title.trim(), (b.description || '').trim(), severity,
      b.financialImpactCad != null && b.financialImpactCad !== '' ? Number(b.financialImpactCad) : null,
      ['open', 'monitoring', 'closed'].includes(b.status) ? b.status : 'open', (b.responseNotes || '').trim(), req.session.userId, now, now);
    logAudit({ userId: req.session.userId, action: 'risk.event_logged', entityType: 'risk_category', entityId: b.categoryId, details: { title: b.title, severity } });
    res.status(201).json(eventRowToJson(db.prepare('SELECT * FROM risk_events WHERE id = ?').get(id)));
  });

  app.put('/api/risk/events/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const e = db.prepare('SELECT * FROM risk_events WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const b = req.body || {};
    const status = ['open', 'monitoring', 'closed'].includes(b.status) ? b.status : e.status;
    db.prepare(
      `UPDATE risk_events SET category_id=@categoryId, occurred_on=@occurredOn, title=@title, description=@description,
         severity=@severity, financial_impact_cad=@fic, status=@status, response_notes=@responseNotes,
         updated_at=@updatedAt, closed_at=@closedAt WHERE id=@id`
    ).run({
      id: e.id,
      categoryId: b.categoryId && db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(b.categoryId) ? b.categoryId : e.category_id,
      occurredOn: b.occurredOn ? String(b.occurredOn).slice(0, 10) : e.occurred_on,
      title: b.title != null ? String(b.title).trim() : e.title,
      description: b.description != null ? String(b.description).trim() : e.description,
      severity: EVENT_SEVERITIES.includes(b.severity) ? b.severity : e.severity,
      fic: b.financialImpactCad !== undefined ? (b.financialImpactCad === '' || b.financialImpactCad == null ? null : Number(b.financialImpactCad)) : e.financial_impact_cad,
      status,
      responseNotes: b.responseNotes != null ? String(b.responseNotes).trim() : e.response_notes,
      updatedAt: new Date().toISOString(),
      closedAt: status === 'closed' ? (e.closed_at || new Date().toISOString()) : null,
    });
    res.json(eventRowToJson(db.prepare('SELECT * FROM risk_events WHERE id = ?').get(e.id)));
  });

  app.post('/api/risk/events/:id/close', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const e = db.prepare('SELECT * FROM risk_events WHERE id = ?').get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const now = new Date().toISOString();
    db.prepare("UPDATE risk_events SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?").run(now, now, e.id);
    res.json(eventRowToJson(db.prepare('SELECT * FROM risk_events WHERE id = ?').get(e.id)));
  });

  // ---- external probability lookup (§7) ----

  app.post('/api/risk/probability-lookup', requireAuth, async (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const title = (b.title || '').trim();
    const description = (b.description || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });
    let categoryId = null;
    if (b.categoryId && db.prepare('SELECT id FROM risk_categories WHERE id = ?').get(b.categoryId)) categoryId = b.categoryId;
    try {
      const { result, usage } = await claude.researchRiskProbability({ title, description, context: (b.context || '').trim() });
      logApiUsage({ callType: 'risk_probability_lookup', usage, userId: req.session.userId });
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO risk_probability_lookups (id, category_id, query, estimate_text, probability_low, probability_high, mapped_score, rationale, caveats, sources, model, searched_by, searched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, categoryId, `${title}${description ? ' — ' + description : ''}`,
        String(result.estimateText || ''),
        result.probabilityLow != null ? Number(result.probabilityLow) : null,
        result.probabilityHigh != null ? Number(result.probabilityHigh) : null,
        result.mappedScore != null ? Number(result.mappedScore) : null,
        String(result.rationale || ''), String(result.caveats || ''),
        JSON.stringify(Array.isArray(result.sources) ? result.sources.slice(0, 6) : []),
        'claude-sonnet-5', req.session.userId, new Date().toISOString()
      );
      logAudit({ userId: req.session.userId, action: 'risk.probability_lookup', entityType: 'risk_category', entityId: categoryId || 'ad-hoc', details: { mappedScore: result.mappedScore } });
      res.json({ configured: true, lookup: lookupRowToJson(db.prepare('SELECT * FROM risk_probability_lookups WHERE id = ?').get(id)) });
    } catch (err) {
      if (err instanceof claude.ClaudeNotConfiguredError) return res.json({ configured: false });
      console.error('risk probability lookup failed:', err.message);
      res.status(502).json({ error: err.message || 'Lookup failed' });
    }
  });

  // ---- profile (§6.4) ----

  app.get('/api/risk/profile', requireAuth, (req, res) => {
    const cats = db.prepare('SELECT * FROM risk_categories WHERE is_active = 1 ORDER BY sort_order').all();
    const points = [];
    let residualSum = 0, inherentSum = 0;
    const bands = { residual: { Low: 0, Medium: 0, High: 0 }, inherent: { Low: 0, Medium: 0, High: 0 } };
    const domainAgg = {};
    let incompleteCount = 0, immediateOpen = 0;
    for (const c of cats) {
      const a = assessmentRowToJson(latestAssessment(c.id));
      if (!a) continue;
      residualSum += a.residualScore;
      inherentSum += a.inherentScore;
      bands.residual[a.residualBand]++;
      bands.inherent[a.inherentBand]++;
      if (a.status === 'INCOMPLETE — Action Required') incompleteCount++;
      const ac = actionCounts(c.id);
      immediateOpen += ac.immediate;
      points.push({
        categoryId: c.id, number: c.number, title: c.title, domainId: c.domain_id,
        residualProb: a.residualProb, residualImpact: a.residualImpact, residualScore: a.residualScore, residualBand: a.residualBand,
        inherentProb: a.inherentProb, inherentImpact: a.inherentImpact, inherentScore: a.inherentScore, inherentBand: a.inherentBand,
        status: a.status, openActions: ac.open,
      });
      const dg = (domainAgg[c.domain_id] ||= { residualScores: [], openActions: 0 });
      dg.residualScores.push(a.residualScore);
      dg.openActions += ac.open;
    }
    const domains = db.prepare('SELECT * FROM risk_domains ORDER BY sort_order').all().map((d) => {
      const g = domainAgg[d.id] || { residualScores: [], openActions: 0 };
      const n = g.residualScores.length;
      return {
        id: d.id, name: d.name,
        meanResidual: n ? +(g.residualScores.reduce((s, v) => s + v, 0) / n).toFixed(1) : 0,
        worstResidual: n ? Math.max(...g.residualScores) : 0,
        openActions: g.openActions,
      };
    });

    // Historical aggregate residual exposure — one point per distinct assessment round.
    const rounds = db.prepare('SELECT DISTINCT assessed_at FROM risk_assessments ORDER BY assessed_at').all().map((r) => r.assessed_at);
    const series = rounds.map((ts) => {
      let sum = 0;
      for (const c of cats) {
        const a = latestAssessment(c.id, ts);
        if (a) sum += scoreOf(a.residual_prob, a.residual_impact);
      }
      return { at: ts, residualExposure: sum };
    });

    // Changes since last review: compare each category's effective assessment at `from`
    // vs `to` (defaults: latest round vs the one before).
    const from = req.query.from || (rounds.length > 1 ? rounds[rounds.length - 2] : rounds[0]);
    const to = req.query.to || rounds[rounds.length - 1];
    const changes = [];
    if (from && to && from !== to) {
      for (const c of cats) {
        const aFrom = latestAssessment(c.id, from);
        const aTo = latestAssessment(c.id, to);
        if (!aTo) continue;
        const rFrom = aFrom ? scoreOf(aFrom.residual_prob, aFrom.residual_impact) : null;
        const rTo = scoreOf(aTo.residual_prob, aTo.residual_impact);
        const statusChanged = (aFrom?.status || null) !== aTo.status;
        if (rFrom !== rTo || statusChanged) {
          changes.push({
            categoryId: c.id, number: c.number, title: c.title,
            residualFrom: rFrom, residualTo: rTo,
            statusFrom: aFrom?.status || null, statusTo: aTo.status,
          });
        }
      }
    }
    const mostImproved = [...changes].filter((c) => c.residualFrom != null && c.residualTo < c.residualFrom).sort((a, b) => (a.residualTo - a.residualFrom) - (b.residualTo - b.residualFrom))[0] || null;
    const mostDeteriorated = [...changes].filter((c) => c.residualFrom != null && c.residualTo > c.residualFrom).sort((a, b) => (b.residualTo - b.residualFrom) - (a.residualTo - a.residualFrom))[0] || null;

    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const evRows = db.prepare('SELECT financial_impact_cad FROM risk_events WHERE occurred_on >= ?').all(cutoff);

    res.json({
      points, bands,
      residualExposure: residualSum, inherentExposure: inherentSum,
      categoriesAssessed: points.length, categoriesTotal: cats.length,
      incompleteCount, immediateOpen,
      events12mo: { count: evRows.length, financialImpactCad: evRows.reduce((s, r) => s + (r.financial_impact_cad || 0), 0) },
      domains, series,
      compare: { from, to, changes, mostImproved, mostDeteriorated },
    });
  });

  // ---- report (§8) ----

  function buildReportModel(query) {
    const activeOnly = query.includeRetired ? '' : ' AND is_active = 1';
    let cats = db.prepare(`SELECT * FROM risk_categories WHERE 1=1${activeOnly} ORDER BY sort_order`).all();
    if (query.domain) cats = cats.filter((c) => String(query.domain).split(',').includes(c.domain_id));
    const rows = cats.map((c) => {
      const a = assessmentRowToJson(latestAssessment(c.id));
      return { category: c, assessment: a, actions: db.prepare('SELECT * FROM risk_actions WHERE category_id = ?').all(c.id).map(actionRowToJson) };
    }).filter((r) => {
      if (query.status && r.assessment && String(query.status).split(',').indexOf(r.assessment.status) === -1) return false;
      if (query.band && r.assessment && String(query.band).split(',').indexOf(r.assessment.residualBand) === -1) return false;
      if (query.accountable && !((r.category.accountable || '').toLowerCase().includes(String(query.accountable).toLowerCase()))) return false;
      return true;
    });
    const domains = db.prepare('SELECT * FROM risk_domains ORDER BY sort_order').all();
    const cutoff = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const events = db.prepare('SELECT * FROM risk_events WHERE occurred_on >= ? ORDER BY occurred_on DESC').all(cutoff).map((r) => {
      const cat = db.prepare('SELECT number, title FROM risk_categories WHERE id = ?').get(r.category_id);
      return { ...eventRowToJson(r), categoryNumber: cat?.number, categoryTitle: cat?.title };
    });
    const residualExposure = rows.reduce((s, r) => s + (r.assessment ? r.assessment.residualScore : 0), 0);
    const inherentExposure = rows.reduce((s, r) => s + (r.assessment ? r.assessment.inherentScore : 0), 0);
    return { domains, rows, events, residualExposure, inherentExposure, generatedAt: new Date().toISOString(), filters: query };
  }

  app.get('/api/risk/report/pdf', requireAuth, async (req, res) => {
    try {
      const pdf = await buildRiskReportPdf(buildReportModel(req.query));
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="RFO-Risk-Register.pdf"');
      res.send(pdf);
    } catch (err) {
      console.error('risk report pdf failed:', err.message);
      res.status(500).json({ error: err.message || 'Failed to build report' });
    }
  });

  app.post('/api/risk/report/email', requireAuth, async (req, res) => {
    const b = req.body || {};
    const to = Array.isArray(b.to) ? b.to.filter(Boolean) : (b.to ? [b.to] : []);
    if (!to.length) return res.status(400).json({ error: 'At least one recipient is required' });
    try {
      const pdf = await buildRiskReportPdf(buildReportModel(b.filters || {}));
      await mailer.sendMail({
        to,
        subject: b.subject || 'RFO Enterprise Risk Register',
        html: emailShell({
          eyebrow: 'Robinson Family Office',
          title: 'Enterprise Risk Register',
          bodyRowsHtml: contentRow(paragraph('The current Risk Register is attached as a PDF.')),
          ctaText: 'Open Risk Management',
          ctaUrl: `${APP_BASE_URL}/risk`,
        }),
        attachments: [{ name: 'RFO-Risk-Register.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }],
      });
      logAudit({ userId: req.session.userId, action: 'risk.report_emailed', entityType: 'risk_report', entityId: 'register', details: { to } });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) return res.status(503).json({ error: 'Email is not configured on the server.' });
      console.error('risk report email failed:', err.message);
      res.status(500).json({ error: err.message || 'Failed to send report' });
    }
  });

  // ---- review reminder settings (admin) — phase-2 scheduler consumes these ----

  app.get('/api/risk/settings', requireAuth, (req, res) => {
    res.json({
      reviewEnabled: getSetting('risk_review_enabled', 'false') === 'true',
      reviewCadence: getSetting('risk_review_cadence', 'quarterly'),
      reviewDayOfWeek: Number(getSetting('risk_review_day_of_week', '1')),
      reviewHourLocal: Number(getSetting('risk_review_hour_local', '8')),
      reviewTimezone: getSetting('risk_review_timezone', 'America/Toronto'),
    });
  });

  app.put('/api/risk/settings', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const set = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    if (b.reviewEnabled != null) set.run('risk_review_enabled', b.reviewEnabled ? 'true' : 'false');
    if (b.reviewCadence) set.run('risk_review_cadence', String(b.reviewCadence));
    if (b.reviewDayOfWeek != null) set.run('risk_review_day_of_week', String(Number(b.reviewDayOfWeek)));
    if (b.reviewHourLocal != null) set.run('risk_review_hour_local', String(Number(b.reviewHourLocal)));
    if (b.reviewTimezone) set.run('risk_review_timezone', String(b.reviewTimezone));
    logAudit({ userId: req.session.userId, action: 'risk.settings_updated', entityType: 'risk_settings', entityId: 'review' });
    res.json({ ok: true });
  });
};

// Attached to the export so test/risk.test.js can exercise the scoring/band logic
// directly without booting a server (same approach as server/expenditure.js).
module.exports.scoreOf = scoreOf;
module.exports.bandOf = bandOf;
module.exports.PRIORITIES = PRIORITIES;
module.exports.STATUS_VALUES = STATUS_VALUES;
