// Maturity Assessment module routes — mounted onto the main app from index.js, same
// pattern as tasks.js / meetings.js / expenditure.js / risk.js.
// See RFO_Maturity_App_BuildSpec_v1.
//
// Permission model (§4): maturity_role is admin / member / viewer, default 'member'
// (every family member self-assesses). An FO admin is always also a Maturity admin.
// Only admins open/close rounds, edit the ladder/questions, or edit another member's
// entries.
//
// Two lenses per round: the Operational Maturity Scorecard (16 services x 1-5,
// questionnaire-driven — "doing things right") and the Capital Consciousness review
// (1-7 arc x 6 dimensions, self-placement — "doing the right things").
//
// Rounds run draft -> open -> closed. The Appendix B data is seeded as a closed,
// benchmark-free, non-anchor reference round; the first in-app cycle closed with
// benchmarks becomes is_anchor and the comparison baseline.
const crypto = require('node:crypto');
const { requireAuth } = require('./auth');
const claude = require('./claude');
const mailer = require('./mailer');
const { logApiUsage } = require('./usage');
const { contentRow, paragraph, emailShell } = require('./email-template');
const { buildMaturityReportPdf } = require('./maturity-report');
const { ACC_ATTRIBUTION, CHANGE_DIMENSIONS, FAMILY_CONTEXT } = require('./maturity-seed-data');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';

// Default Family Task List category for promoted actions — the existing "04. Maturity"
// category under the Strategy pillar (migration 013). Any task_categories id may be
// chosen on the promote form; this is the default.
const DEFAULT_TASK_CATEGORY_ID = 'maturity';

// Scoring rule (§5.3) — mirrored verbatim in public/maturity.html and
// server/maturity-report.js. A member's level for a service = weighted mean of their
// answers on the 1-5 line, rounded to the nearest 0.5, clamped to 1..5.
function levelRollup(answers, questions) {
  const qById = new Map(questions.map((q) => [q.id, q]));
  let wsum = 0;
  let w = 0;
  for (const a of answers) {
    const q = qById.get(a.questionId);
    if (!q) continue;
    const v = Number(a.value);
    if (!Number.isFinite(v)) continue;
    const weight = Number(q.weight) || 1;
    wsum += v * weight;
    w += weight;
  }
  if (w === 0) return null;
  return clampLevel(Math.round((wsum / w) * 2) / 2);
}
function clampLevel(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, n));
}
// UI band for a 1-5 level — mirrored in the frontend + report.
function levelClass(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 'none';
  if (n < 2) return 'l1';
  if (n < 3) return 'l2';
  if (n < 4) return 'l3';
  if (n < 5) return 'l4';
  return 'l5';
}

module.exports = function registerMaturityRoutes(app, { db, logAudit }) {
  function myRoles(userId) {
    const row = db.prepare('SELECT is_fo_admin, maturity_role, tasks_role FROM users WHERE id = ?').get(userId);
    if (!row) return { isFoAdmin: false, maturityAdmin: false, maturityMember: false, tasksMember: false };
    const isFoAdmin = !!row.is_fo_admin;
    return {
      isFoAdmin,
      maturityAdmin: isFoAdmin || row.maturity_role === 'admin',
      maturityMember: isFoAdmin || row.maturity_role === 'admin' || row.maturity_role === 'member',
      tasksMember: isFoAdmin || row.tasks_role === 'admin' || row.tasks_role === 'member',
    };
  }
  const requireMember = (req, res) => {
    if (!myRoles(req.session.userId).maturityMember) {
      res.status(403).json({ error: 'This action needs Maturity member or admin access.' });
      return false;
    }
    return true;
  };
  const requireAdmin = (req, res) => {
    if (!myRoles(req.session.userId).maturityAdmin) {
      res.status(403).json({ error: 'Maturity admin only.' });
      return false;
    }
    return true;
  };

  const _nameCache = new Map();
  function userName(id) {
    if (!id) return null;
    if (_nameCache.has(id)) return _nameCache.get(id);
    const row = db.prepare('SELECT name FROM users WHERE id = ?').get(id);
    const n = row ? row.name : null;
    _nameCache.set(id, n);
    return n;
  }
  function familyMemberIds() {
    return db.prepare("SELECT id FROM users WHERE is_active = 1 ORDER BY rowid").all().map((r) => r.id);
  }
  function jsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  // ---- rounds ----

  function roundRowToJson(r) {
    if (!r) return null;
    return {
      id: r.id, label: r.label, status: r.status,
      periodStart: r.period_start, periodEnd: r.period_end,
      openedAt: r.opened_at, openedBy: r.opened_by, openedByName: userName(r.opened_by),
      closedAt: r.closed_at, closedBy: r.closed_by,
      notes: r.notes, carriedFrom: r.carried_from, isAnchor: !!r.is_anchor,
      synthesis: r.synthesis_json ? jsonParse(r.synthesis_json, null) : null,
      createdAt: r.created_at,
    };
  }
  const getRound = (id) => db.prepare('SELECT * FROM maturity_rounds WHERE id = ?').get(id);
  const activeRound = () => db.prepare("SELECT * FROM maturity_rounds WHERE status IN ('draft','open') ORDER BY created_at DESC LIMIT 1").get();
  const anchorRound = () =>
    db.prepare("SELECT * FROM maturity_rounds WHERE is_anchor = 1 LIMIT 1").get() ||
    db.prepare("SELECT * FROM maturity_rounds WHERE status = 'closed' ORDER BY closed_at ASC LIMIT 1").get();
  function resolveRoundId(q) {
    if (q && q.round) return q.round;
    const a = activeRound();
    if (a) return a.id;
    const latest = db.prepare("SELECT id FROM maturity_rounds WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1").get();
    return latest ? latest.id : null;
  }

  // ---- reference data / ladder ----

  function levelLabels() {
    return db.prepare('SELECT level, name, blurb FROM maturity_level_labels ORDER BY level').all();
  }
  function servicesList(includeRetired) {
    const where = includeRetired ? '' : 'WHERE is_active = 1';
    return db.prepare(`SELECT * FROM maturity_services ${where} ORDER BY sort_order, number`).all();
  }
  function descriptorsFor(serviceId) {
    return db.prepare('SELECT level, text FROM maturity_level_descriptors WHERE service_id = ? ORDER BY level').all(serviceId);
  }
  function questionsFor(serviceId, includeInactive) {
    const where = includeInactive ? '' : 'AND is_active = 1';
    return db.prepare(`SELECT * FROM maturity_questions WHERE service_id = ? ${where} ORDER BY sort_order, rowid`).all(serviceId)
      .map((q) => ({ id: q.id, serviceId: q.service_id, prompt: q.prompt, helpText: q.help_text, responseKind: q.response_kind, weight: q.weight, sortOrder: q.sort_order, isActive: !!q.is_active }));
  }

  // family stats for one (round, service): mean/min/max/spread over SUBMITTED scores only
  function serviceStats(roundId, serviceId) {
    const rows = db.prepare(
      'SELECT user_id, level FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND submitted = 1'
    ).all(roundId, serviceId);
    const byUser = {};
    const vals = [];
    for (const r of rows) { byUser[r.user_id] = r.level; vals.push(r.level); }
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {
      byUser,
      count: vals.length,
      mean: mean == null ? null : Math.round(mean * 100) / 100,
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
      spread: vals.length ? Math.round((Math.max(...vals) - Math.min(...vals)) * 100) / 100 : null,
    };
  }
  function benchmarkFor(roundId, serviceId) {
    const b = db.prepare('SELECT * FROM maturity_benchmarks WHERE round_id = ? AND service_id = ?').get(roundId, serviceId);
    if (!b) return null;
    return {
      id: b.id, serviceId: b.service_id, benchmarkLevel: b.benchmark_level, rationale: b.rationale,
      whatWouldMoveUp: jsonParse(b.what_would_move_up, []), sources: jsonParse(b.sources, []),
      caveats: b.caveats, model: b.model, searchedBy: b.searched_by, searchedByName: userName(b.searched_by), searchedAt: b.searched_at,
    };
  }
  function actionRowToJson(r) {
    const task = r.task_id ? taskInfo(r.task_id) : null;
    let effectiveStatus = r.status;
    if (r.task_id && task && !task.deleted) effectiveStatus = task.status === 'done' ? 'done' : 'in_progress';
    return {
      id: r.id, roundId: r.round_id, serviceId: r.service_id, dimensionId: r.dimension_id,
      title: r.title, detail: r.detail, targetLevel: r.target_level, changeDimension: r.change_dimension,
      priority: r.priority, ownerText: r.owner_text, dueQuarter: r.due_quarter,
      status: r.status, effectiveStatus, taskId: r.task_id, task,
      linkedTaskDeleted: !!(r.task_id && task && task.deleted),
      completedAt: r.completed_at, archivedAt: r.archived_at,
      createdBy: r.created_by, createdByName: userName(r.created_by), createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }
  function taskInfo(taskId) {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!t) return { deleted: true };
    const assignees = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(t.id);
    const all = assignees.some((a) => a.user_id === null);
    return {
      deleted: false, id: t.id, title: t.title, status: t.status, priority: t.priority,
      targetQuarter: t.target_quarter, completedAt: t.completed_at, categoryId: t.category_id,
      assignedToAll: all,
      assigneeNames: all ? ['All'] : assignees.map((a) => userName(a.user_id)).filter(Boolean),
    };
  }
  function openActionCount(roundId, serviceId) {
    const rows = db.prepare(
      'SELECT * FROM maturity_actions WHERE service_id = ? AND archived_at IS NULL' + (roundId ? ' AND (round_id = ? OR round_id IS NULL)' : '')
    ).all(...(roundId ? [serviceId, roundId] : [serviceId])).map(actionRowToJson);
    const open = rows.filter((a) => a.effectiveStatus !== 'done');
    return { total: rows.length, open: open.length, immediate: open.filter((a) => a.priority === 'Immediate').length };
  }

  // ---- Capital Consciousness helpers ----

  function ccDimensions() {
    return db.prepare('SELECT * FROM maturity_cc_dimensions ORDER BY sort_order').all()
      .map((d) => ({ id: d.id, name: d.name, sortOrder: d.sort_order, serviceIds: jsonParse(d.service_ids, []) }));
  }
  function ccProfile(roundId) {
    const dims = ccDimensions();
    const prevId = previousClosedRoundId(roundId);
    return dims.map((d) => {
      const rows = db.prepare('SELECT user_id, level, reflection, submitted FROM maturity_cc_responses WHERE round_id = ? AND dimension_id = ?').all(roundId, d.id);
      const submitted = rows.filter((r) => r.submitted);
      const vals = submitted.map((r) => r.level).sort((a, b) => a - b);
      const median = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
      let prevMedian = null;
      if (prevId) {
        const pv = db.prepare('SELECT level FROM maturity_cc_responses WHERE round_id = ? AND dimension_id = ? AND submitted = 1').all(prevId, d.id).map((r) => r.level).sort((a, b) => a - b);
        prevMedian = pv.length ? (pv.length % 2 ? pv[(pv.length - 1) / 2] : (pv[pv.length / 2 - 1] + pv[pv.length / 2]) / 2) : null;
      }
      return {
        dimensionId: d.id, name: d.name, serviceIds: d.serviceIds,
        members: rows.map((r) => ({ userId: r.user_id, name: userName(r.user_id), level: r.level, reflection: r.reflection, submitted: !!r.submitted })),
        centreOfGravity: median,
        range: vals.length ? [vals[0], vals[vals.length - 1]] : null,
        spread: vals.length ? vals[vals.length - 1] - vals[0] : null,
        straddlesThreshold: vals.length ? (vals[0] < 4 && vals[vals.length - 1] >= 4) : false,
        prevCentreOfGravity: prevMedian,
      };
    });
  }
  function previousClosedRoundId(roundId) {
    const r = getRound(roundId);
    if (!r) return null;
    const ref = r.closed_at || r.created_at;
    const prev = db.prepare("SELECT id FROM maturity_rounds WHERE status = 'closed' AND id != ? AND COALESCE(closed_at, created_at) < ? ORDER BY COALESCE(closed_at, created_at) DESC LIMIT 1").get(roundId, ref);
    return prev ? prev.id : null;
  }

  // ===================================================================================
  // READ
  // ===================================================================================

  function roundCompletion(roundId, meId) {
    const activeServices = servicesList(false);
    const ccTotal = ccDimensions().length;
    return familyMemberIds().map((uid) => {
      const done = db.prepare('SELECT COUNT(*) AS n FROM maturity_service_scores WHERE round_id = ? AND user_id = ? AND submitted = 1').get(roundId, uid).n;
      const ccDone = db.prepare('SELECT COUNT(*) AS n FROM maturity_cc_responses WHERE round_id = ? AND user_id = ? AND submitted = 1').get(roundId, uid).n;
      return { userId: uid, me: uid === meId, name: userName(uid), servicesDone: done, servicesTotal: activeServices.length, ccDone, ccTotal, complete: done >= activeServices.length && ccDone >= ccTotal };
    });
  }

  app.get('/api/maturity/overview', requireAuth, (req, res) => {
    const roundId = resolveRoundId(req.query);
    const round = roundId ? roundRowToJson(getRound(roundId)) : null;
    if (round && (round.status === 'open' || round.status === 'draft')) {
      round.completion = roundCompletion(roundId, req.session.userId);
    }
    const groups = db.prepare('SELECT * FROM maturity_service_groups ORDER BY sort_order').all()
      .map((g) => ({ id: g.id, name: g.name, sortOrder: g.sort_order }));
    const includeRetired = req.query.retired === '1';
    const services = servicesList(includeRetired).map((s) => {
      const stats = roundId ? serviceStats(roundId, s.id) : { byUser: {}, count: 0, mean: null, min: null, max: null, spread: null };
      const bench = roundId ? benchmarkFor(roundId, s.id) : null;
      return {
        id: s.id, groupId: s.group_id, number: s.number, name: s.name, description: s.description,
        sortOrder: s.sort_order, isActive: !!s.is_active,
        descriptors: descriptorsFor(s.id),
        stats,
        benchmark: bench,
        gap: (bench && stats.mean != null) ? Math.round((bench.benchmarkLevel - stats.mean) * 100) / 100 : null,
        actionCounts: openActionCount(roundId, s.id),
      };
    });
    const rounds = db.prepare('SELECT * FROM maturity_rounds ORDER BY COALESCE(closed_at, opened_at, created_at) DESC').all().map(roundRowToJson);
    const memberRows = db.prepare("SELECT id, name, is_fo_admin, maturity_role FROM users WHERE is_active = 1 ORDER BY rowid").all();
    res.json({
      round, rounds, groups, services,
      levelLabels: levelLabels(),
      members: memberRows.map((m) => ({ id: m.id, name: m.name, maturityRole: m.maturity_role, maturityAdmin: !!m.is_fo_admin || m.maturity_role === 'admin' })),
      anchorRoundId: anchorRound()?.id || null,
      generatedAt: new Date().toISOString(),
    });
  });

  app.get('/api/maturity/services/:id', requireAuth, (req, res) => {
    const s = db.prepare('SELECT * FROM maturity_services WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Service not found' });
    const roundId = resolveRoundId(req.query);
    const scores = roundId
      ? db.prepare('SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = ?').all(roundId, s.id).map((r) => ({
          id: r.id, userId: r.user_id, userName: userName(r.user_id), level: r.level, computedLevel: r.computed_level,
          method: r.method, rationale: r.rationale, submitted: !!r.submitted, submittedAt: r.submitted_at,
        }))
      : [];
    const myResponses = roundId
      ? db.prepare('SELECT question_id, value, note FROM maturity_responses WHERE round_id = ? AND service_id = ? AND user_id = ?')
          .all(roundId, s.id, req.session.userId)
          .map((r) => ({ questionId: r.question_id, value: r.value, note: r.note }))
      : [];
    const trend = db.prepare("SELECT id, label, closed_at FROM maturity_rounds WHERE status = 'closed' ORDER BY COALESCE(closed_at, created_at) ASC").all()
      .map((r) => {
        const st = serviceStats(r.id, s.id);
        const b = benchmarkFor(r.id, s.id);
        return { roundId: r.id, label: r.label, mean: st.mean, benchmark: b ? b.benchmarkLevel : null };
      });
    const suggestions = roundId
      ? db.prepare("SELECT * FROM maturity_descriptor_suggestions WHERE round_id = ? AND service_id = ? ORDER BY level").all(roundId, s.id)
          .map((r) => ({ id: r.id, level: r.level, currentText: r.current_text, suggestedText: r.suggested_text, rationale: r.rationale, sources: jsonParse(r.sources, []), status: r.status, appliedText: r.applied_text }))
      : [];
    res.json({
      service: { id: s.id, groupId: s.group_id, number: s.number, name: s.name, description: s.description, isActive: !!s.is_active },
      descriptors: descriptorsFor(s.id),
      questions: questionsFor(s.id, req.query.allQuestions === '1'),
      levelLabels: levelLabels(),
      roundId,
      scores,
      myResponses,
      benchmark: roundId ? benchmarkFor(roundId, s.id) : null,
      stats: roundId ? serviceStats(roundId, s.id) : null,
      trend,
      suggestions,
      actions: db.prepare('SELECT * FROM maturity_actions WHERE service_id = ? AND archived_at IS NULL ORDER BY created_at').all(s.id).map(actionRowToJson),
    });
  });

  app.get('/api/maturity/rounds', requireAuth, (req, res) => {
    const rounds = db.prepare('SELECT * FROM maturity_rounds ORDER BY COALESCE(closed_at, opened_at, created_at) DESC').all().map((r) => {
      const j = roundRowToJson(r);
      // completion per member for a draft/open round
      if (r.status === 'open' || r.status === 'draft') {
        const activeServices = servicesList(false);
        const members = familyMemberIds();
        j.completion = members.map((uid) => {
          const done = db.prepare('SELECT COUNT(*) AS n FROM maturity_service_scores WHERE round_id = ? AND user_id = ? AND submitted = 1').get(r.id, uid).n;
          const ccDone = db.prepare('SELECT COUNT(*) AS n FROM maturity_cc_responses WHERE round_id = ? AND user_id = ? AND submitted = 1').get(r.id, uid).n;
          const ccTotal = ccDimensions().length;
          return { userId: uid, name: userName(uid), servicesDone: done, servicesTotal: activeServices.length, ccDone, ccTotal, complete: done >= activeServices.length && ccDone >= ccTotal };
        });
      }
      return j;
    });
    res.json({ rounds, anchorRoundId: anchorRound()?.id || null });
  });

  app.get('/api/maturity/rounds/:id', requireAuth, (req, res) => {
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    res.json({ round: roundRowToJson(r), ladder: jsonParse(r.ladder_json, {}) });
  });

  app.get('/api/maturity/cc', requireAuth, (req, res) => {
    const roundId = resolveRoundId(req.query);
    const dims = ccDimensions();
    const prompts = db.prepare('SELECT * FROM maturity_cc_prompts ORDER BY dimension_id, sort_order').all()
      .map((p) => ({ id: p.id, dimensionId: p.dimension_id, prompt: p.prompt, sortOrder: p.sort_order }));
    const myResponses = roundId
      ? db.prepare('SELECT dimension_id, level, reflection, submitted FROM maturity_cc_responses WHERE round_id = ? AND user_id = ?')
          .all(roundId, req.session.userId)
          .map((r) => ({ dimensionId: r.dimension_id, level: r.level, reflection: r.reflection, submitted: !!r.submitted }))
      : [];
    res.json({
      roundId,
      levels: db.prepare('SELECT level, name, tagline, description FROM maturity_cc_levels ORDER BY level').all(),
      dimensions: dims,
      prompts,
      myResponses,
      profile: roundId ? ccProfile(roundId) : [],
      changeDimensions: CHANGE_DIMENSIONS,
      attribution: ACC_ATTRIBUTION,
    });
  });

  app.get('/api/maturity/profile', requireAuth, (req, res) => {
    const roundId = resolveRoundId(req.query);
    if (!roundId) return res.json({ roundId: null, services: [], radar: [], aggregateSeries: [], ccProfile: [] });
    const services = servicesList(false);
    const closedRounds = db.prepare("SELECT id, label, closed_at, created_at FROM maturity_rounds WHERE status = 'closed' ORDER BY COALESCE(closed_at, created_at) ASC").all();
    // aggregate self-reported mean & benchmark mean per closed round
    const aggregateSeries = closedRounds.map((r) => {
      const means = services.map((s) => serviceStats(r.id, s.id).mean).filter((m) => m != null);
      const benches = services.map((s) => { const b = benchmarkFor(r.id, s.id); return b ? b.benchmarkLevel : null; }).filter((m) => m != null);
      return {
        roundId: r.id, label: r.label,
        familyMean: means.length ? Math.round((means.reduce((a, b) => a + b, 0) / means.length) * 100) / 100 : null,
        benchmarkMean: benches.length ? Math.round((benches.reduce((a, b) => a + b, 0) / benches.length) * 100) / 100 : null,
      };
    });
    const prevId = previousClosedRoundId(roundId);
    const radar = services.map((s) => {
      const cur = serviceStats(roundId, s.id).mean;
      const prev = prevId ? serviceStats(prevId, s.id).mean : null;
      const b = benchmarkFor(roundId, s.id);
      return { serviceId: s.id, name: s.name, number: s.number, familyMean: cur, prevMean: prev, benchmark: b ? b.benchmarkLevel : null, delta: (cur != null && prev != null) ? Math.round((cur - prev) * 100) / 100 : null };
    });
    res.json({
      roundId, prevRoundId: prevId, anchorRoundId: anchorRound()?.id || null,
      radar, aggregateSeries,
      ccProfile: ccProfile(roundId),
      changesSince: radar.filter((x) => x.delta != null && x.delta !== 0).sort((a, b) => a.delta - b.delta),
    });
  });

  app.get('/api/maturity/actions', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM maturity_actions WHERE archived_at IS NULL ORDER BY created_at DESC').all().map(actionRowToJson);
    res.json({ actions: rows });
  });

  // ===================================================================================
  // ASSESSMENT (member)
  // ===================================================================================

  // Upsert the caller's responses for one service in a round, then recompute + upsert
  // their maturity_service_scores row (method 'questionnaire').
  app.put('/api/maturity/responses', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const round = getRound(b.roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const svc = db.prepare('SELECT id FROM maturity_services WHERE id = ? AND is_active = 1').get(b.serviceId);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const questions = questionsFor(b.serviceId, false);
    const qIds = new Set(questions.map((q) => q.id));
    const answers = Array.isArray(b.responses) ? b.responses.filter((a) => qIds.has(a.questionId)) : [];
    const now = new Date().toISOString();
    const up = db.prepare(
      `INSERT INTO maturity_responses (id, round_id, service_id, user_id, question_id, value, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id, service_id, user_id, question_id)
       DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at`
    );
    for (const a of answers) {
      up.run(crypto.randomUUID(), b.roundId, b.serviceId, req.session.userId, a.questionId, clampLevel(a.value) ?? 3, (a.note || '').trim(), now);
    }
    const stored = db.prepare('SELECT question_id AS questionId, value FROM maturity_responses WHERE round_id = ? AND service_id = ? AND user_id = ?')
      .all(b.roundId, b.serviceId, req.session.userId);
    const computed = levelRollup(stored, questions);
    // keep an unsubmitted score row in sync so the scorecard preview + submit work
    const existing = db.prepare('SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND user_id = ?').get(b.roundId, b.serviceId, req.session.userId);
    if (existing && existing.method === 'direct' && existing.submitted) {
      // don't clobber a submitted direct override; just refresh computed_level
      db.prepare('UPDATE maturity_service_scores SET computed_level = ? WHERE id = ?').run(computed, existing.id);
    } else if (existing) {
      db.prepare('UPDATE maturity_service_scores SET level = ?, computed_level = ?, method = ? WHERE id = ?')
        .run(computed ?? existing.level, computed, 'questionnaire', existing.id);
    } else if (computed != null) {
      db.prepare(
        `INSERT INTO maturity_service_scores (id, round_id, service_id, user_id, level, computed_level, method, rationale, submitted, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'questionnaire', '', 0, NULL)`
      ).run(crypto.randomUUID(), b.roundId, b.serviceId, req.session.userId, computed, computed);
    }
    res.json({ computedLevel: computed, stored: stored.length });
  });

  app.post('/api/maturity/services/:serviceId/submit', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const roundId = (req.body || {}).roundId;
    const round = getRound(roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const row = db.prepare('SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND user_id = ?').get(roundId, req.params.serviceId, req.session.userId);
    if (!row || row.level == null) return res.status(400).json({ error: 'Answer the questions for this service first.' });
    db.prepare('UPDATE maturity_service_scores SET submitted = 1, submitted_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    logAudit({ userId: req.session.userId, action: 'maturity.service_submitted', entityType: 'maturity_service', entityId: req.params.serviceId, details: { roundId } });
    res.json({ ok: true });
  });

  // Direct level entry / override. Self for own row; admin for anyone.
  app.put('/api/maturity/scores', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const round = getRound(b.roundId);
    if (!round || round.status === 'closed') return res.status(400).json({ error: 'That round is not editable.' });
    const targetUser = b.userId && b.userId !== req.session.userId ? b.userId : req.session.userId;
    if (targetUser !== req.session.userId && !myRoles(req.session.userId).maturityAdmin) {
      return res.status(403).json({ error: 'Only a Maturity admin can enter a score for another member.' });
    }
    if (!db.prepare('SELECT id FROM maturity_services WHERE id = ?').get(b.serviceId)) return res.status(404).json({ error: 'Service not found' });
    const level = clampLevel(b.level);
    if (level == null) return res.status(400).json({ error: 'level must be 1..5' });
    const existing = db.prepare('SELECT * FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND user_id = ?').get(b.roundId, b.serviceId, targetUser);
    const now = new Date().toISOString();
    if (existing) {
      db.prepare('UPDATE maturity_service_scores SET level = ?, method = ?, rationale = ?, submitted = ?, submitted_at = ? WHERE id = ?')
        .run(level, 'direct', (b.rationale || '').trim(), b.submitted ? 1 : existing.submitted, (b.submitted && !existing.submitted) ? now : existing.submitted_at, existing.id);
    } else {
      db.prepare(
        `INSERT INTO maturity_service_scores (id, round_id, service_id, user_id, level, computed_level, method, rationale, submitted, submitted_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'direct', ?, ?, ?)`
      ).run(crypto.randomUUID(), b.roundId, b.serviceId, targetUser, level, (b.rationale || '').trim(), b.submitted ? 1 : 0, b.submitted ? now : null);
    }
    logAudit({ userId: req.session.userId, action: 'maturity.score_set', entityType: 'maturity_service', entityId: b.serviceId, details: { roundId: b.roundId, targetUser, level } });
    res.json({ ok: true });
  });

  // ---- Capital Consciousness (member) ----

  app.put('/api/maturity/cc-responses', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const round = getRound(b.roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const dimIds = new Set(ccDimensions().map((d) => d.id));
    const items = Array.isArray(b.responses) ? b.responses.filter((r) => dimIds.has(r.dimensionId)) : [];
    const now = new Date().toISOString();
    const up = db.prepare(
      `INSERT INTO maturity_cc_responses (id, round_id, user_id, dimension_id, level, reflection, submitted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(round_id, user_id, dimension_id)
       DO UPDATE SET level = excluded.level, reflection = excluded.reflection, updated_at = excluded.updated_at`
    );
    for (const r of items) {
      const lvl = Math.max(1, Math.min(7, Math.round(Number(r.level) || 0)));
      up.run(crypto.randomUUID(), b.roundId, req.session.userId, r.dimensionId, lvl, (r.reflection || '').trim(), now);
    }
    res.json({ ok: true, stored: items.length });
  });

  app.post('/api/maturity/cc/submit', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const roundId = (req.body || {}).roundId;
    const round = getRound(roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const dims = ccDimensions();
    const have = db.prepare('SELECT COUNT(*) AS n FROM maturity_cc_responses WHERE round_id = ? AND user_id = ?').get(roundId, req.session.userId).n;
    if (have < dims.length) return res.status(400).json({ error: 'Place yourself on all dimensions first.' });
    db.prepare('UPDATE maturity_cc_responses SET submitted = 1 WHERE round_id = ? AND user_id = ?').run(roundId, req.session.userId);
    logAudit({ userId: req.session.userId, action: 'maturity.cc_submitted', entityType: 'maturity_round', entityId: roundId });
    res.json({ ok: true });
  });

  // ===================================================================================
  // ROUND LIFECYCLE (admin)
  // ===================================================================================

  app.post('/api/maturity/rounds', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (activeRound()) return res.status(400).json({ error: 'A round is already draft or open. Close it first.' });
    const b = req.body || {};
    const label = (b.label || '').trim();
    if (!label) return res.status(400).json({ error: 'label is required' });
    const id = 'round-' + crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const carryFrom = b.carryFrom && getRound(b.carryFrom) ? b.carryFrom : null;
    db.prepare(
      `INSERT INTO maturity_rounds (id, label, status, period_start, period_end, notes, ladder_json, carried_from, is_anchor, created_at)
       VALUES (?, ?, 'draft', ?, ?, ?, '{}', ?, 0, ?)`
    ).run(id, label, (b.periodStart || '').trim() || null, (b.periodEnd || '').trim() || null, (b.notes || '').trim(), carryFrom, now);
    logAudit({ userId: req.session.userId, action: 'maturity.round_started', entityType: 'maturity_round', entityId: id, details: { label, carryFrom } });
    res.status(201).json({ id });
  });

  app.post('/api/maturity/rounds/:id/open', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (r.status !== 'draft') return res.status(400).json({ error: 'Only a draft round can be opened.' });
    const now = new Date().toISOString();
    // snapshot the ladder as it stands now (with any accepted descriptor edits)
    const ladder = {
      services: servicesList(false).map((s) => ({ id: s.id, number: s.number, name: s.name, groupId: s.group_id })),
      levelLabels: levelLabels(),
      descriptors: {},
      questions: {},
    };
    for (const s of servicesList(false)) {
      ladder.descriptors[s.id] = descriptorsFor(s.id);
      ladder.questions[s.id] = questionsFor(s.id, false);
    }
    db.prepare("UPDATE maturity_rounds SET status = 'open', opened_at = ?, opened_by = ?, ladder_json = ? WHERE id = ?")
      .run(now, req.session.userId, JSON.stringify(ladder), r.id);
    // carry-forward pre-fill (unsubmitted) from carried_from
    if (r.carried_from) {
      const src = r.carried_from;
      for (const s of servicesList(false)) {
        const prev = db.prepare('SELECT user_id, level FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND submitted = 1').all(src, s.id);
        for (const p of prev) {
          const exists = db.prepare('SELECT id FROM maturity_service_scores WHERE round_id = ? AND service_id = ? AND user_id = ?').get(r.id, s.id, p.user_id);
          if (!exists) {
            db.prepare(
              `INSERT INTO maturity_service_scores (id, round_id, service_id, user_id, level, computed_level, method, rationale, submitted, submitted_at)
               VALUES (?, ?, ?, ?, ?, NULL, 'direct', 'Carried forward from prior round', 0, NULL)`
            ).run(crypto.randomUUID(), r.id, s.id, p.user_id, p.level);
          }
        }
      }
      for (const d of ccDimensions()) {
        const prev = db.prepare('SELECT user_id, level, reflection FROM maturity_cc_responses WHERE round_id = ? AND dimension_id = ? AND submitted = 1').all(src, d.id);
        for (const p of prev) {
          const exists = db.prepare('SELECT id FROM maturity_cc_responses WHERE round_id = ? AND user_id = ? AND dimension_id = ?').get(r.id, p.user_id, d.id);
          if (!exists) {
            db.prepare(
              `INSERT INTO maturity_cc_responses (id, round_id, user_id, dimension_id, level, reflection, submitted, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
            ).run(crypto.randomUUID(), r.id, p.user_id, d.id, p.level, p.reflection, now);
          }
        }
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.round_opened', entityType: 'maturity_round', entityId: r.id });
    res.json({ ok: true });
  });

  app.post('/api/maturity/rounds/:id/close', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (r.status !== 'open') return res.status(400).json({ error: 'Only an open round can be closed.' });
    const now = new Date().toISOString();
    const hasBenchmarks = db.prepare('SELECT COUNT(*) AS n FROM maturity_benchmarks WHERE round_id = ?').get(r.id).n > 0;
    const anchorExists = db.prepare('SELECT COUNT(*) AS n FROM maturity_rounds WHERE is_anchor = 1').get().n > 0;
    const becomeAnchor = hasBenchmarks && !anchorExists ? 1 : 0;
    db.prepare("UPDATE maturity_rounds SET status = 'closed', closed_at = ?, closed_by = ?, is_anchor = ? WHERE id = ?")
      .run(now, req.session.userId, becomeAnchor, r.id);
    // snapshot payload
    const payload = buildRoundModel(r.id);
    db.prepare('INSERT INTO maturity_round_snapshots (id, round_id, taken_at, taken_by, label, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), r.id, now, req.session.userId, r.label, JSON.stringify(payload));
    logAudit({ userId: req.session.userId, action: 'maturity.round_closed', entityType: 'maturity_round', entityId: r.id, details: { becomeAnchor: !!becomeAnchor } });
    res.json({ ok: true, isAnchor: !!becomeAnchor });
  });

  app.put('/api/maturity/rounds/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    const b = req.body || {};
    if (b.notes != null) db.prepare('UPDATE maturity_rounds SET notes = ? WHERE id = ?').run(String(b.notes).trim(), r.id);
    if (b.label != null && String(b.label).trim()) db.prepare('UPDATE maturity_rounds SET label = ? WHERE id = ?').run(String(b.label).trim(), r.id);
    res.json({ ok: true });
  });

  function buildRoundModel(roundId) {
    const r = getRound(roundId);
    const services = servicesList(true).map((s) => ({
      id: s.id, number: s.number, name: s.name, groupId: s.group_id,
      descriptors: descriptorsFor(s.id),
      stats: serviceStats(roundId, s.id),
      scores: db.prepare('SELECT user_id, level, method, rationale, submitted FROM maturity_service_scores WHERE round_id = ? AND service_id = ?').all(roundId, s.id)
        .map((x) => ({ userId: x.user_id, name: userName(x.user_id), level: x.level, method: x.method, rationale: x.rationale, submitted: !!x.submitted })),
      benchmark: benchmarkFor(roundId, s.id),
    }));
    return {
      round: roundRowToJson(r),
      groups: db.prepare('SELECT id, name, sort_order FROM maturity_service_groups ORDER BY sort_order').all(),
      levelLabels: levelLabels(),
      services,
      ccProfile: ccProfile(roundId),
      actions: db.prepare('SELECT * FROM maturity_actions WHERE (round_id = ? OR round_id IS NULL) AND archived_at IS NULL').all(roundId).map(actionRowToJson),
      generatedAt: new Date().toISOString(),
    };
  }
  app.get('/api/maturity/round-model/:id', requireAuth, (req, res) => {
    if (!getRound(req.params.id)) return res.status(404).json({ error: 'Round not found' });
    res.json(buildRoundModel(req.params.id));
  });

  // ---- reporting (all roles) ----
  function reportRoundId(q) {
    return (q && q.round) || anchorRound()?.id ||
      db.prepare("SELECT id FROM maturity_rounds WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1").get()?.id ||
      activeRound()?.id || null;
  }
  app.get('/api/maturity/report/pdf', requireAuth, async (req, res) => {
    const rid = reportRoundId(req.query);
    if (!rid) return res.status(404).json({ error: 'No round to report on yet.' });
    try {
      const pdf = await buildMaturityReportPdf(buildRoundModel(rid));
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="RFO-Maturity-Assessment.pdf"');
      res.send(pdf);
    } catch (err) {
      console.error('maturity report pdf failed:', err.message);
      res.status(500).json({ error: err.message || 'Failed to build report' });
    }
  });
  app.post('/api/maturity/report/email', requireAuth, async (req, res) => {
    const b = req.body || {};
    const to = Array.isArray(b.to) ? b.to.filter(Boolean) : (b.to ? [b.to] : []);
    if (!to.length) return res.status(400).json({ error: 'At least one recipient is required' });
    const rid = reportRoundId(b);
    if (!rid) return res.status(404).json({ error: 'No round to report on yet.' });
    try {
      const pdf = await buildMaturityReportPdf(buildRoundModel(rid));
      await mailer.sendMail({
        to,
        subject: b.subject || 'RFO Maturity Assessment',
        html: emailShell({
          eyebrow: 'Robinson Family Office',
          title: 'Maturity Assessment',
          bodyRowsHtml: contentRow(paragraph('The latest Maturity Assessment scorecard is attached as a PDF.')),
          ctaText: 'Open Maturity Assessment',
          ctaUrl: `${APP_BASE_URL}/maturity`,
        }),
        attachments: [{ name: 'RFO-Maturity-Assessment.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }],
      });
      logAudit({ userId: req.session.userId, action: 'maturity.report_emailed', entityType: 'maturity_report', entityId: rid, details: { to } });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) return res.status(503).json({ error: 'Email is not configured on the server.' });
      console.error('maturity report email failed:', err.message);
      res.status(500).json({ error: err.message || 'Failed to send report' });
    }
  });

  // ===================================================================================
  // LADDER EDITING (admin)
  // ===================================================================================

  app.put('/api/maturity/services/:id/descriptors/:level', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const svc = db.prepare('SELECT id FROM maturity_services WHERE id = ?').get(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const level = Number(req.params.level);
    if (![1, 2, 3, 4, 5].includes(level)) return res.status(400).json({ error: 'level must be 1..5' });
    const text = (req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO maturity_level_descriptors (id, service_id, level, text, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id, level) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(crypto.randomUUID(), svc.id, level, text, now, req.session.userId);
    logAudit({ userId: req.session.userId, action: 'maturity.descriptor_edited', entityType: 'maturity_service', entityId: svc.id, details: { level } });
    res.json({ ok: true });
  });

  app.put('/api/maturity/level-labels/:level', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const level = Number(req.params.level);
    if (![1, 2, 3, 4, 5].includes(level)) return res.status(400).json({ error: 'level must be 1..5' });
    const b = req.body || {};
    const cur = db.prepare('SELECT * FROM maturity_level_labels WHERE level = ?').get(level);
    if (!cur) return res.status(404).json({ error: 'Level label not found' });
    db.prepare('UPDATE maturity_level_labels SET name = ?, blurb = ? WHERE level = ?')
      .run(b.name != null ? String(b.name).trim() : cur.name, b.blurb != null ? String(b.blurb).trim() : cur.blurb, level);
    res.json({ ok: true });
  });

  app.put('/api/maturity/cc-levels/:level', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const level = Number(req.params.level);
    if (level < 1 || level > 7) return res.status(400).json({ error: 'level must be 1..7' });
    const cur = db.prepare('SELECT * FROM maturity_cc_levels WHERE level = ?').get(level);
    if (!cur) return res.status(404).json({ error: 'CC level not found' });
    const b = req.body || {};
    db.prepare('UPDATE maturity_cc_levels SET name = ?, tagline = ?, description = ? WHERE level = ?').run(
      b.name != null ? String(b.name).trim() : cur.name,
      b.tagline != null ? String(b.tagline).trim() : cur.tagline,
      b.description != null ? String(b.description).trim() : cur.description,
      level
    );
    res.json({ ok: true });
  });

  // question authoring
  app.post('/api/maturity/services/:id/questions', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const svc = db.prepare('SELECT id FROM maturity_services WHERE id = ?').get(req.params.id);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    const b = req.body || {};
    if (!b.prompt) return res.status(400).json({ error: 'prompt is required' });
    const kind = ['scale_1_5', 'level_pick'].includes(b.responseKind) ? b.responseKind : 'scale_1_5';
    const maxSort = db.prepare('SELECT MAX(sort_order) AS m FROM maturity_questions WHERE service_id = ?').get(svc.id).m || 0;
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO maturity_questions (id, service_id, prompt, help_text, response_kind, weight, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
    ).run(id, svc.id, String(b.prompt).trim(), (b.helpText || '').trim(), kind, Number(b.weight) || 1, maxSort + 1);
    res.status(201).json({ id });
  });
  app.put('/api/maturity/questions/:qid', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = db.prepare('SELECT * FROM maturity_questions WHERE id = ?').get(req.params.qid);
    if (!q) return res.status(404).json({ error: 'Question not found' });
    const b = req.body || {};
    db.prepare('UPDATE maturity_questions SET prompt = ?, help_text = ?, response_kind = ?, weight = ?, sort_order = ?, is_active = ? WHERE id = ?').run(
      b.prompt != null ? String(b.prompt).trim() : q.prompt,
      b.helpText != null ? String(b.helpText).trim() : q.help_text,
      ['scale_1_5', 'level_pick'].includes(b.responseKind) ? b.responseKind : q.response_kind,
      b.weight != null ? Number(b.weight) || 1 : q.weight,
      b.sortOrder != null ? Number(b.sortOrder) : q.sort_order,
      b.isActive != null ? (b.isActive ? 1 : 0) : q.is_active,
      q.id
    );
    res.json({ ok: true });
  });
  app.delete('/api/maturity/questions/:qid', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    db.prepare('UPDATE maturity_questions SET is_active = 0 WHERE id = ?').run(req.params.qid);
    res.json({ ok: true });
  });

  // service rename / retire / restore (Manage tab, §6.7). Add / new category left for a
  // follow-up — the seed covers the initial catalogue.
  app.put('/api/maturity/services/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const s = db.prepare('SELECT * FROM maturity_services WHERE id = ?').get(req.params.id);
    if (!s) return res.status(404).json({ error: 'Service not found' });
    const b = req.body || {};
    db.prepare('UPDATE maturity_services SET name = ?, description = ?, is_active = ?, sort_order = ? WHERE id = ?').run(
      b.name != null ? String(b.name).trim() : s.name,
      b.description != null ? String(b.description).trim() : s.description,
      b.isActive != null ? (b.isActive ? 1 : 0) : s.is_active,
      b.sortOrder != null ? Number(b.sortOrder) : s.sort_order,
      s.id
    );
    logAudit({ userId: req.session.userId, action: 'maturity.service_edited', entityType: 'maturity_service', entityId: s.id });
    res.json({ ok: true });
  });

  // ===================================================================================
  // CLAUDE — benchmark / synthesis / descriptor suggestions (member+, degrade gracefully)
  // ===================================================================================

  app.post('/api/maturity/rounds/:id/benchmark', requireAuth, async (req, res) => {
    if (!requireMember(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    const only = (req.body || {}).serviceId;
    const targets = only
      ? servicesList(true).filter((s) => s.id === only)
      : servicesList(false);
    if (!targets.length) return res.status(400).json({ error: 'No services to benchmark' });
    const labels = levelLabels().map((l) => l.name);
    const results = [];
    const errors = [];
    for (const s of targets) {
      try {
        const stat = serviceStats(r.id, s.id);
        const { result, usage } = await claude.benchmarkMaturityService({
          serviceName: s.name,
          description: s.description || '',
          levelLabels: labels,
          levelDescriptors: descriptorsFor(s.id).map((d) => d.text),
          familyContext: FAMILY_CONTEXT,
          selfAssessedLevel: stat.mean,
        });
        logApiUsage({ callType: 'maturity_benchmark', usage, userId: req.session.userId });
        const level = clampLevel(Math.round((Number(result.benchmarkLevel) || 3) * 2) / 2) ?? 3;
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO maturity_benchmarks (id, round_id, service_id, benchmark_level, rationale, what_would_move_up, sources, caveats, model, searched_by, searched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id, service_id) DO UPDATE SET benchmark_level = excluded.benchmark_level, rationale = excluded.rationale,
             what_would_move_up = excluded.what_would_move_up, sources = excluded.sources, caveats = excluded.caveats,
             model = excluded.model, searched_by = excluded.searched_by, searched_at = excluded.searched_at`
        ).run(
          crypto.randomUUID(), r.id, s.id, level, String(result.rationale || ''),
          JSON.stringify(Array.isArray(result.whatWouldMoveUp) ? result.whatWouldMoveUp : []),
          JSON.stringify(Array.isArray(result.sources) ? result.sources : []),
          String(result.caveats || ''), 'claude-sonnet-5', req.session.userId, now
        );
        results.push({ serviceId: s.id, benchmarkLevel: level });
      } catch (err) {
        if (err instanceof claude.ClaudeNotConfiguredError) return res.json({ configured: false });
        errors.push({ serviceId: s.id, error: err.message });
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.benchmark_run', entityType: 'maturity_round', entityId: r.id, details: { count: results.length, errors: errors.length } });
    res.json({ configured: true, results, errors });
  });

  app.post('/api/maturity/rounds/:id/synthesis', requireAuth, async (req, res) => {
    if (!requireMember(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    const prevId = previousClosedRoundId(r.id);
    const services = servicesList(false).map((s) => {
      const st = serviceStats(r.id, s.id);
      const b = benchmarkFor(r.id, s.id);
      const prev = prevId ? serviceStats(prevId, s.id).mean : null;
      const g = db.prepare('SELECT name FROM maturity_service_groups WHERE id = ?').get(s.group_id);
      return { name: s.name, category: g ? g.name : '', familyMean: st.mean, benchmarkLevel: b ? b.benchmarkLevel : null, prevFamilyMean: prev };
    });
    try {
      const { result, usage } = await claude.synthesizeMaturityRound({
        services,
        ccProfile: ccProfile(r.id).map((d) => ({ dimension: d.name, memberLevels: d.members.filter((m) => m.submitted).map((m) => m.level), centreOfGravity: d.centreOfGravity, range: d.range, prevCentre: d.prevCentreOfGravity })),
        familyContext: FAMILY_CONTEXT,
      });
      logApiUsage({ callType: 'maturity_synthesis', usage, userId: req.session.userId });
      db.prepare('UPDATE maturity_rounds SET synthesis_json = ? WHERE id = ?').run(JSON.stringify(result), r.id);
      logAudit({ userId: req.session.userId, action: 'maturity.synthesis_run', entityType: 'maturity_round', entityId: r.id });
      res.json({ configured: true, synthesis: result });
    } catch (err) {
      if (err instanceof claude.ClaudeNotConfiguredError) return res.json({ configured: false });
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/maturity/rounds/:id/suggest-descriptors', requireAuth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (r.status !== 'draft') return res.status(400).json({ error: 'Descriptor suggestions can only be run while the round is a draft.' });
    const only = (req.body || {}).serviceId;
    const targets = only ? servicesList(true).filter((s) => s.id === only) : servicesList(false);
    const labels = levelLabels().map((l) => l.name);
    const results = [];
    const errors = [];
    for (const s of targets) {
      try {
        const current = descriptorsFor(s.id);
        const { result, usage } = await claude.suggestLevelDescriptors({
          serviceName: s.name, description: s.description || '',
          levelLabels: labels, currentDescriptors: current.map((d) => d.text), familyContext: FAMILY_CONTEXT,
        });
        logApiUsage({ callType: 'maturity_descriptor_suggest', usage, userId: req.session.userId });
        const now = new Date().toISOString();
        db.prepare('DELETE FROM maturity_descriptor_suggestions WHERE round_id = ? AND service_id = ?').run(r.id, s.id);
        const ins = db.prepare(
          `INSERT INTO maturity_descriptor_suggestions (id, round_id, service_id, level, current_text, suggested_text, rationale, sources, status, model, searched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        );
        const levels = Array.isArray(result.levels) ? result.levels : [];
        for (const lv of levels) {
          const level = Number(lv.level);
          if (![1, 2, 3, 4, 5].includes(level)) continue;
          const curText = (current.find((d) => d.level === level) || {}).text || '';
          ins.run(crypto.randomUUID(), r.id, s.id, level, curText, String(lv.suggestedText || curText), String(lv.rationale || ''), JSON.stringify(Array.isArray(result.sources) ? result.sources : []), 'claude-sonnet-5', now);
        }
        results.push({ serviceId: s.id, levels: levels.length });
      } catch (err) {
        if (err instanceof claude.ClaudeNotConfiguredError) return res.json({ configured: false });
        errors.push({ serviceId: s.id, error: err.message });
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.descriptors_suggested', entityType: 'maturity_round', entityId: r.id, details: { count: results.length } });
    res.json({ configured: true, results, errors });
  });

  app.post('/api/maturity/descriptor-suggestions/:id/accept', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sug = db.prepare('SELECT * FROM maturity_descriptor_suggestions WHERE id = ?').get(req.params.id);
    if (!sug) return res.status(404).json({ error: 'Suggestion not found' });
    const text = ((req.body || {}).text || sug.suggested_text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is empty' });
    const edited = text !== sug.suggested_text;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO maturity_level_descriptors (id, service_id, level, text, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id, level) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(crypto.randomUUID(), sug.service_id, sug.level, text, now, req.session.userId);
    db.prepare('UPDATE maturity_descriptor_suggestions SET status = ?, applied_text = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run(edited ? 'accepted_edited' : 'accepted', text, req.session.userId, now, sug.id);
    logAudit({ userId: req.session.userId, action: 'maturity.descriptor_accepted', entityType: 'maturity_service', entityId: sug.service_id, details: { level: sug.level, edited } });
    res.json({ ok: true });
  });

  app.post('/api/maturity/descriptor-suggestions/:id/dismiss', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sug = db.prepare('SELECT * FROM maturity_descriptor_suggestions WHERE id = ?').get(req.params.id);
    if (!sug) return res.status(404).json({ error: 'Suggestion not found' });
    db.prepare('UPDATE maturity_descriptor_suggestions SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run('dismissed', req.session.userId, new Date().toISOString(), sug.id);
    res.json({ ok: true });
  });

  // ===================================================================================
  // ACTIONS (member) + Family Task List sync
  // ===================================================================================

  app.post('/api/maturity/actions', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'title is required' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const priority = ['Immediate', 'Active', 'Monitor'].includes(b.priority) ? b.priority : 'Active';
    db.prepare(
      `INSERT INTO maturity_actions (id, round_id, service_id, dimension_id, title, detail, target_level, change_dimension, priority, owner_text, due_quarter, status, task_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, ?)`
    ).run(
      id, b.roundId || null, b.serviceId || null, b.dimensionId || null,
      String(b.title).trim(), (b.detail || '').trim(),
      b.targetLevel != null ? Number(b.targetLevel) : null,
      CHANGE_DIMENSIONS.includes(b.changeDimension) ? b.changeDimension : null,
      priority, (b.ownerText || '').trim(), (b.dueQuarter || '').trim() || null,
      req.session.userId, now, now
    );
    logAudit({ userId: req.session.userId, action: 'maturity.action_created', entityType: 'maturity_action', entityId: id });
    res.status(201).json(actionRowToJson(db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(id)));
  });

  app.put('/api/maturity/actions/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const a = db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(req.params.id);
    if (!a || a.archived_at) return res.status(404).json({ error: 'Action not found' });
    const b = req.body || {};
    const now = new Date().toISOString();
    const status = ['open', 'in_progress', 'done'].includes(b.status) ? b.status : a.status;
    db.prepare(
      `UPDATE maturity_actions SET title = ?, detail = ?, priority = ?, owner_text = ?, due_quarter = ?, target_level = ?, change_dimension = ?,
         status = ?, completed_at = ?, updated_at = ? WHERE id = ?`
    ).run(
      b.title != null ? String(b.title).trim() : a.title,
      b.detail != null ? String(b.detail).trim() : a.detail,
      ['Immediate', 'Active', 'Monitor'].includes(b.priority) ? b.priority : a.priority,
      b.ownerText != null ? String(b.ownerText).trim() : a.owner_text,
      b.dueQuarter != null ? (String(b.dueQuarter).trim() || null) : a.due_quarter,
      b.targetLevel !== undefined ? (b.targetLevel != null ? Number(b.targetLevel) : null) : a.target_level,
      b.changeDimension !== undefined ? (CHANGE_DIMENSIONS.includes(b.changeDimension) ? b.changeDimension : null) : a.change_dimension,
      status, status === 'done' ? (a.completed_at || now) : null, now, a.id
    );
    res.json(actionRowToJson(db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(a.id)));
  });

  app.delete('/api/maturity/actions/:id', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const a = db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Action not found' });
    db.prepare('UPDATE maturity_actions SET archived_at = ?, updated_at = ? WHERE id = ?').run(new Date().toISOString(), new Date().toISOString(), a.id);
    res.json({ ok: true });
  });

  app.post('/api/maturity/actions/:id/promote', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.maturityMember) return res.status(403).json({ error: 'This action needs Maturity member or admin access.' });
    if (!roles.tasksMember) return res.status(403).json({ error: 'Adding to the Family Task List needs Task List member or admin access.' });
    const a = db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(req.params.id);
    if (!a || a.archived_at) return res.status(404).json({ error: 'Action not found' });
    if (a.task_id && db.prepare('SELECT id FROM tasks WHERE id = ?').get(a.task_id)) {
      return res.status(400).json({ error: 'This action is already linked to a task.' });
    }
    const b = req.body || {};
    const categoryId = (b.categoryId && db.prepare('SELECT id FROM task_categories WHERE id = ?').get(b.categoryId))
      ? b.categoryId
      : (db.prepare('SELECT id FROM task_categories WHERE id = ?').get(DEFAULT_TASK_CATEGORY_ID) ? DEFAULT_TASK_CATEGORY_ID : db.prepare('SELECT id FROM task_categories ORDER BY sort_order LIMIT 1').get()?.id);
    if (!categoryId) return res.status(400).json({ error: 'No task category available' });
    const priority = ['high', 'medium', 'low'].includes(b.priority) ? b.priority : (a.priority === 'Immediate' ? 'high' : 'medium');
    const svc = a.service_id ? db.prepare('SELECT number, name FROM maturity_services WHERE id = ?').get(a.service_id) : null;
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const notes = `From Maturity — ${svc ? `#${svc.number} ${svc.name}` : 'synthesis'}.` + (a.detail ? ` ${a.detail}` : '');
    db.prepare(
      `INSERT INTO tasks (id, category_id, parent_task_id, title, priority, target_quarter, target_date, status, completed_at, notes, source_ref_id, created_by, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, NULL, 'open', NULL, ?, NULL, ?, ?, ?)`
    ).run(taskId, categoryId, (b.title || a.title).trim(), priority, (b.targetQuarter || a.due_quarter || '').trim() || null, notes, req.session.userId, now, now);
    if (b.assignedToAll) {
      db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, NULL)').run(taskId);
    } else if (Array.isArray(b.assigneeIds)) {
      for (const uid of b.assigneeIds) {
        if (db.prepare('SELECT id FROM users WHERE id = ?').get(uid)) db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, uid);
      }
    }
    db.prepare('UPDATE maturity_actions SET task_id = ?, updated_at = ? WHERE id = ?').run(taskId, now, a.id);
    logAudit({ userId: req.session.userId, action: 'maturity.action_promoted_to_task', entityType: 'maturity_action', entityId: a.id, details: { taskId, categoryId } });
    logAudit({ userId: req.session.userId, action: 'task.created', entityType: 'task', entityId: taskId, details: { fromMaturityActionId: a.id } });
    res.json(actionRowToJson(db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(a.id)));
  });

  app.post('/api/maturity/actions/:id/unlink', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const a = db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: 'Action not found' });
    db.prepare('UPDATE maturity_actions SET task_id = NULL, updated_at = ? WHERE id = ?').run(new Date().toISOString(), a.id);
    res.json(actionRowToJson(db.prepare('SELECT * FROM maturity_actions WHERE id = ?').get(a.id)));
  });
};

module.exports.levelRollup = levelRollup;
module.exports.levelClass = levelClass;
