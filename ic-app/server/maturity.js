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
// (a standalone, once-per-round instrument — "doing the right things"). The two are
// deliberately NOT merged into one worksheet — see maturity-seed-data.js's header
// comment on CONSCIOUSNESS_STATEMENTS for why an earlier per-service version was dropped.
//
// Rounds run draft -> open -> closed. The Appendix B data is seeded as a closed,
// benchmark-free, non-anchor reference round; the first in-app cycle closed with
// benchmarks becomes is_anchor and the comparison baseline.
const crypto = require('node:crypto');
const { requireAuth } = require('./auth');
const claude = require('./claude');
const mailer = require('./mailer');
const { logApiUsage } = require('./usage');
const { contentRow, paragraph, emailShell, escapeHtml } = require('./email-template');
const { buildMaturityReportPdf } = require('./maturity-report');
const { CONSCIOUSNESS_NOTE, CONSCIOUSNESS_QUESTION, CHANGE_DIMENSIONS, FAMILY_CONTEXT } = require('./maturity-seed-data');

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

  // ---- live evidence from the rest of the app (§7.1 follow-up) ----
  // A hand-written `description` goes stale the moment the family's real activity moves
  // on. This pulls FRESH, CURRENT signal — at benchmark/suggestion time, not seeded —
  // from the same app's other modules (Family Task List, Risk Register, Meetings, Due
  // Diligence), which all share this one database. Kept factual and quantified
  // (counts, titles, dates), never a maturity judgment.
  const TASK_CATEGORY_BY_SERVICE = {
    'svc-01': ['accountability-succession'],
    'svc-02': ['maturity', 'conflict-resolution'],
    'svc-03': ['risk-management'],
    'svc-04': ['relationships', 'conflict-resolution'],
    'svc-05': ['learning'],
    'svc-06': ['wellness'],
    'svc-07': ['investment'],
    'svc-08': ['investment'],
    'svc-09': ['philanthropy'],
    'svc-10': ['tax-estate'],
    'svc-11': ['tax-estate'],
    'svc-12': ['finance'],
    'svc-13': ['it'],
    // svc-14 Legal, svc-15 External Relationships, svc-16 External Communication have no
    // dedicated Family Task List category — no task-list signal for these.
  };
  function liveEvidenceFor(serviceId) {
    const parts = [];
    const catIds = TASK_CATEGORY_BY_SERVICE[serviceId];
    if (catIds && catIds.length) {
      const ph = catIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT status FROM tasks WHERE category_id IN (${ph})`).all(...catIds);
      if (rows.length) {
        const done = rows.filter((r) => r.status === 'done').length;
        const recentDone = db.prepare(
          `SELECT title, completed_at FROM tasks WHERE category_id IN (${ph}) AND status = 'done' ORDER BY completed_at DESC LIMIT 3`
        ).all(...catIds);
        const openSoon = db.prepare(
          `SELECT title, target_quarter FROM tasks WHERE category_id IN (${ph}) AND status != 'done' ORDER BY (priority = 'high') DESC, target_quarter LIMIT 3`
        ).all(...catIds);
        parts.push(
          `Family Task List (live): ${done} of ${rows.length} tracked tasks completed.` +
          (recentDone.length ? ` Recently completed: ${recentDone.map((t) => `"${t.title}" (${(t.completed_at || '').slice(0, 10)})`).join('; ')}.` : '') +
          (openSoon.length ? ` Currently open: ${openSoon.map((t) => `"${t.title}"${t.target_quarter ? ' (' + t.target_quarter + ')' : ''}`).join('; ')}.` : '')
        );
      }
    }
    if (serviceId === 'svc-03') {
      const catCount = db.prepare('SELECT COUNT(*) n FROM risk_categories WHERE is_active = 1').get().n;
      const a = db.prepare(
        "SELECT COUNT(*) n, SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) openA, SUM(CASE WHEN status = 'incomplete' THEN 1 ELSE 0 END) incomplete FROM risk_actions"
      ).get();
      if (catCount || a.n) {
        parts.push(
          `Enterprise Risk Register (live, this app's Risk module): ${catCount} active risk categories tracked; of ${a.n} identified mitigation actions, ${a.openA || 0} are open and ${a.incomplete || 0} are flagged incomplete.`
        );
      }
    }
    if (serviceId === 'svc-07' || serviceId === 'svc-08') {
      const opps = db.prepare('SELECT title, asset_class, commitment, currency, status FROM opportunities ORDER BY created_at DESC').all();
      if (opps.length) {
        parts.push(
          `Due Diligence module (live): ${opps.length} investment opportunit${opps.length === 1 ? 'y' : 'ies'} run through this app's due diligence process — ` +
          opps.map((o) => `"${o.title}" (${o.asset_class}, ${o.currency} ${Number(o.commitment).toLocaleString()}, ${o.status})`).join('; ') + '.'
        );
      }
    }
    return parts.join(' ');
  }
  // Cross-cutting (not per-service) — recent Family Council / Investment Committee
  // meetings actually held, from this app's Meetings module. Shows the governance cadence
  // in action, not just documented as a plan.
  function recentGovernanceActivity() {
    const meetings = db.prepare("SELECT title, planned_at FROM meetings WHERE status = 'completed' ORDER BY planned_at DESC LIMIT 3").all();
    if (!meetings.length) return '';
    return `Recently held family governance meetings (live, this app's Meetings module): ${meetings.map((m) => `"${m.title}" (${(m.planned_at || '').slice(0, 10)})`).join('; ')}.`;
  }

  const median = (sorted) => (sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null);

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
      id: b.id, serviceId: b.service_id,
      peerLevel: b.peer_level, peerRationale: b.peer_rationale,
      assessedLevel: b.assessed_level, assessedRationale: b.assessed_rationale,
      recommendedPriority: b.recommended_priority, recommendation: b.recommendation,
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

  function previousClosedRoundId(roundId) {
    const r = getRound(roundId);
    if (!r) return null;
    const ref = r.closed_at || r.created_at;
    const prev = db.prepare("SELECT id FROM maturity_rounds WHERE status = 'closed' AND id != ? AND COALESCE(closed_at, created_at) < ? ORDER BY COALESCE(closed_at, created_at) DESC LIMIT 1").get(roundId, ref);
    return prev ? prev.id : null;
  }

  // ---- Capital Consciousness — standalone, once per round (§5.8) ----

  const ccLevels = () => db.prepare('SELECT level, name, tagline, description FROM maturity_cc_levels ORDER BY level').all();
  const ccStatements = () => db.prepare('SELECT level, statement FROM maturity_consciousness_statements ORDER BY level').all();

  // family-wide rollup for a round: centre of gravity (median of submitted member
  // levels), dispersion, and whether the family straddles the Level-4 threshold —
  // deliberately never averaged into one number, per the white paper's own point that the
  // differences between members are where the most important work happens.
  function consciousnessRoundSummary(roundId) {
    if (!roundId) return { cog: null, min: null, max: null, spread: null, count: 0, straddlesThreshold: false, members: [] };
    const rows = db.prepare(
      `SELECT s.user_id, s.level, s.note, s.submitted FROM maturity_consciousness_scores s WHERE s.round_id = ?`
    ).all(roundId);
    const submitted = rows.filter((r) => r.submitted);
    const vals = submitted.map((r) => r.level).sort((a, b) => a - b);
    return {
      cog: median(vals),
      min: vals.length ? vals[0] : null,
      max: vals.length ? vals[vals.length - 1] : null,
      spread: vals.length ? Math.round((vals[vals.length - 1] - vals[0]) * 100) / 100 : null,
      count: vals.length,
      straddlesThreshold: vals.length ? (vals[0] < 4 && vals[vals.length - 1] >= 4) : false,
      members: submitted.map((r) => ({ userId: r.user_id, name: userName(r.user_id), level: r.level, note: r.note || '' })),
    };
  }

  // ===================================================================================
  // READ
  // ===================================================================================

  function roundCompletion(roundId, meId) {
    const activeServices = servicesList(false);
    return familyMemberIds().map((uid) => {
      const done = db.prepare('SELECT COUNT(*) AS n FROM maturity_service_scores WHERE round_id = ? AND user_id = ? AND submitted = 1').get(roundId, uid).n;
      const ccDone = db.prepare("SELECT submitted FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = ?").get(roundId, uid)?.submitted ? 1 : 0;
      return {
        userId: uid, me: uid === meId, name: userName(uid),
        servicesDone: done, servicesTotal: activeServices.length,
        consciousnessDone: ccDone,
        complete: done >= activeServices.length && ccDone === 1,
      };
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
        gap: (bench && stats.mean != null) ? Math.round((bench.peerLevel - stats.mean) * 100) / 100 : null,
        actionCounts: openActionCount(roundId, s.id),
      };
    });
    const rounds = db.prepare('SELECT * FROM maturity_rounds ORDER BY COALESCE(closed_at, opened_at, created_at) DESC').all().map(roundRowToJson);
    const memberRows = db.prepare("SELECT id, name, is_fo_admin, maturity_role FROM users WHERE is_active = 1 ORDER BY rowid").all();
    res.json({
      round, rounds, groups, services,
      levelLabels: levelLabels(),
      consciousnessLevels: ccLevels(),
      consciousnessNote: CONSCIOUSNESS_NOTE,
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
        return { roundId: r.id, label: r.label, mean: st.mean, benchmark: b ? b.peerLevel : null, assessed: b ? b.assessedLevel : null };
      });
    const suggestions = roundId
      ? db.prepare("SELECT * FROM maturity_descriptor_suggestions WHERE round_id = ? AND service_id = ? ORDER BY level").all(roundId, s.id)
          .map((r) => ({ id: r.id, level: r.level, currentText: r.current_text, suggestedText: r.suggested_text, rationale: r.rationale, sources: jsonParse(r.sources, []), status: r.status, appliedText: r.applied_text }))
      : [];
    const questionSuggestions = roundId
      ? db.prepare("SELECT * FROM maturity_question_suggestions WHERE round_id = ? AND service_id = ? ORDER BY rowid").all(roundId, s.id)
          .map((r) => ({
            id: r.id, questionId: r.question_id,
            currentPrompt: r.current_prompt, currentHelpText: r.current_help_text,
            suggestedPrompt: r.suggested_prompt, suggestedHelpText: r.suggested_help_text,
            rationale: r.rationale, sources: jsonParse(r.sources, []), status: r.status,
            appliedPrompt: r.applied_prompt, appliedHelpText: r.applied_help_text,
          }))
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
      questionSuggestions,
      actions: db.prepare('SELECT * FROM maturity_actions WHERE service_id = ? AND archived_at IS NULL ORDER BY created_at').all(s.id).map(actionRowToJson),
    });
  });

  app.get('/api/maturity/rounds', requireAuth, (req, res) => {
    const rounds = db.prepare('SELECT * FROM maturity_rounds ORDER BY COALESCE(closed_at, opened_at, created_at) DESC').all().map((r) => {
      const j = roundRowToJson(r);
      if (r.status === 'open' || r.status === 'draft') j.completion = roundCompletion(r.id, req.session.userId);
      return j;
    });
    res.json({ rounds, anchorRoundId: anchorRound()?.id || null });
  });

  app.get('/api/maturity/rounds/:id', requireAuth, (req, res) => {
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    res.json({ round: roundRowToJson(r), ladder: jsonParse(r.ladder_json, {}) });
  });

  // Capital Consciousness — the standalone instrument for this round: the 7 statements,
  // the caller's own pick/score, and the family-wide rollup so far.
  app.get('/api/maturity/cc', requireAuth, (req, res) => {
    const roundId = resolveRoundId(req.query);
    const myScoreRow = roundId
      ? db.prepare('SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = ?').get(roundId, req.session.userId)
      : null;
    res.json({
      roundId,
      levels: ccLevels(),
      statements: ccStatements(),
      question: CONSCIOUSNESS_QUESTION,
      changeDimensions: CHANGE_DIMENSIONS,
      note: CONSCIOUSNESS_NOTE,
      myScore: myScoreRow ? { level: myScoreRow.level, computedLevel: myScoreRow.computed_level, method: myScoreRow.method, note: myScoreRow.note, submitted: !!myScoreRow.submitted } : null,
      summary: roundId ? consciousnessRoundSummary(roundId) : null,
      prevSummary: roundId ? consciousnessRoundSummary(previousClosedRoundId(roundId)) : null,
    });
  });

  app.get('/api/maturity/profile', requireAuth, (req, res) => {
    const roundId = resolveRoundId(req.query);
    if (!roundId) return res.json({ roundId: null, services: [], radar: [], aggregateSeries: [], consciousness: null });
    const services = servicesList(false);
    const closedRounds = db.prepare("SELECT id, label, closed_at, created_at FROM maturity_rounds WHERE status = 'closed' ORDER BY COALESCE(closed_at, created_at) ASC").all();
    // aggregate self-reported mean & benchmark mean per closed round
    const aggregateSeries = closedRounds.map((r) => {
      const means = services.map((s) => serviceStats(r.id, s.id).mean).filter((m) => m != null);
      const benches = services.map((s) => { const b = benchmarkFor(r.id, s.id); return b ? b.peerLevel : null; }).filter((m) => m != null);
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
      return { serviceId: s.id, name: s.name, number: s.number, familyMean: cur, prevMean: prev, benchmark: b ? b.peerLevel : null, assessed: b ? b.assessedLevel : null, delta: (cur != null && prev != null) ? Math.round((cur - prev) * 100) / 100 : null };
    });
    res.json({
      roundId, prevRoundId: prevId, anchorRoundId: anchorRound()?.id || null,
      radar, aggregateSeries,
      consciousness: {
        levels: ccLevels(),
        summary: consciousnessRoundSummary(roundId),
        prevSummary: consciousnessRoundSummary(prevId),
      },
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

  // ---- Capital Consciousness (member) — standalone, once per round ----

  // Sets the caller's Capital Consciousness placement for the round by picking the ONE
  // statement (of the 7) that best reflects the family today — the level IS that
  // statement's level, no computation and no separate override path (two earlier
  // approaches, rating each statement 1-5 independently and then ranking all 7, both
  // proved more confusing than the thing they were meant to simplify). `level` and `note`
  // can be sent independently, so typing a note never requires re-picking.
  // `method` stays 'questionnaire' for an active pick; carry-forward pre-fill (see
  // POST /rounds/:id/open) still uses 'direct' to mean "not yet reconfirmed this round".
  app.put('/api/maturity/consciousness-pick', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const b = req.body || {};
    const round = getRound(b.roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const hasLevel = b.level != null;
    let level = null;
    if (hasLevel) {
      // a discrete pick from the 7 statements — reject anything that isn't one of them,
      // rather than silently clamping an out-of-range value into looking like a valid pick
      const raw = Number(b.level);
      if (!Number.isInteger(raw) || !ccStatements().some((s) => s.level === raw)) return res.status(400).json({ error: 'level must match one of the statements' });
      level = raw;
    }
    const hasNote = b.note != null;
    const note = hasNote ? String(b.note).trim() : '';
    const existing = db.prepare('SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = ?').get(b.roundId, req.session.userId);
    if (existing) {
      const sets = [];
      const params = { id: existing.id };
      if (hasLevel) { sets.push('level = @lvl', 'computed_level = @lvl', "method = 'questionnaire'"); params.lvl = level; }
      if (hasNote) { sets.push('note = @note'); params.note = note; }
      if (sets.length) db.prepare(`UPDATE maturity_consciousness_scores SET ${sets.join(', ')} WHERE id = @id`).run(params);
    } else if (hasLevel) {
      db.prepare(
        `INSERT INTO maturity_consciousness_scores (id, round_id, user_id, level, computed_level, method, note, submitted, submitted_at)
         VALUES (?, ?, ?, ?, ?, 'questionnaire', ?, 0, NULL)`
      ).run(crypto.randomUUID(), b.roundId, req.session.userId, level, level, note);
    }
    res.json({ ok: true, level });
  });

  app.post('/api/maturity/consciousness/submit', requireAuth, (req, res) => {
    if (!requireMember(req, res)) return;
    const roundId = (req.body || {}).roundId;
    const round = getRound(roundId);
    if (!round || round.status !== 'open') return res.status(400).json({ error: 'That round is not open for assessment.' });
    const row = db.prepare('SELECT * FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = ?').get(roundId, req.session.userId);
    if (!row || row.level == null) return res.status(400).json({ error: 'Pick the statement that best reflects the family first.' });
    db.prepare('UPDATE maturity_consciousness_scores SET submitted = 1, submitted_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
    logAudit({ userId: req.session.userId, action: 'maturity.consciousness_submitted', entityType: 'maturity_round', entityId: roundId });
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
      // Capital Consciousness is a fresh, once-per-round read, but carrying the prior
      // placement forward (unsubmitted, method 'direct' — "not yet reconfirmed") keeps
      // continuity: a member who agrees can just re-submit; anyone who's shifted just
      // picks a different statement, which flips method back to 'questionnaire'.
      const prevCc = db.prepare('SELECT user_id, level, note FROM maturity_consciousness_scores WHERE round_id = ? AND submitted = 1').all(src);
      for (const p of prevCc) {
        const exists = db.prepare('SELECT id FROM maturity_consciousness_scores WHERE round_id = ? AND user_id = ?').get(r.id, p.user_id);
        if (!exists) {
          db.prepare(
            `INSERT INTO maturity_consciousness_scores (id, round_id, user_id, level, computed_level, method, note, submitted, submitted_at)
             VALUES (?, ?, ?, ?, NULL, 'direct', ?, 0, NULL)`
          ).run(crypto.randomUUID(), r.id, p.user_id, p.level, p.note || '');
        }
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.round_opened', entityType: 'maturity_round', entityId: r.id });
    res.json({ ok: true });
  });

  // Notify family members to go complete their assessment. Purely admin-triggered — no
  // email is ever sent automatically on a state transition (opening a round does NOT
  // notify anyone by itself), so the timing of outreach stays entirely in the admin's
  // hands. Defaults to everyone who hasn't finished yet; the admin can instead target a
  // specific subset via userIds (e.g. a resend to one straggler, or a "closing soon" nudge
  // to everyone including those already done). Each email is personalized with that
  // member's own progress so far.
  app.post('/api/maturity/rounds/:id/invite', requireAuth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (r.status !== 'open') return res.status(400).json({ error: 'The round must be open before inviting the family to assess it.' });
    if (!mailer.isConfigured()) return res.status(503).json({ error: 'Email is not configured on the server.' });
    const b = req.body || {};
    const completion = roundCompletion(r.id, req.session.userId);
    const eligible = completion.filter((c) => {
      const row = db.prepare('SELECT is_fo_admin, maturity_role FROM users WHERE id = ?').get(c.userId);
      return row && (row.is_fo_admin || row.maturity_role === 'admin' || row.maturity_role === 'member');
    });
    const targets = Array.isArray(b.userIds) && b.userIds.length
      ? eligible.filter((c) => b.userIds.includes(c.userId))
      : eligible.filter((c) => !c.complete);
    const note = (b.note || '').trim();
    const adminName = userName(req.session.userId) || 'An admin';
    const sent = [];
    const skipped = [];
    const errors = [];
    for (const c of targets) {
      const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(c.userId);
      if (!user || !user.email) { skipped.push({ userId: c.userId, name: c.name, reason: 'no email on file' }); continue; }
      let statusLine;
      if (c.complete) {
        statusLine = "You've already completed this round — thank you!";
      } else if (c.servicesDone === 0 && !c.consciousnessDone) {
        statusLine = "You haven't started yet.";
      } else {
        statusLine = `Your progress so far: ${c.servicesDone} of ${c.servicesTotal} services completed, ` +
          `Capital Consciousness ${c.consciousnessDone ? 'placed' : 'not yet placed'}.`;
      }
      try {
        await mailer.sendMail({
          to: user.email,
          subject: `${r.label} — please complete your Maturity Assessment`,
          html: emailShell({
            eyebrow: 'Robinson Family Office',
            title: 'Maturity Assessment',
            subtitle: r.label,
            bodyRowsHtml: contentRow(
              paragraph(`${escapeHtml(adminName)} is asking every family member to complete the <b>${escapeHtml(r.label)}</b> Maturity Assessment.`) +
              paragraph(`<b>${escapeHtml(statusLine)}</b>`) +
              (note ? paragraph(escapeHtml(note)) : '')
            ),
            ctaText: 'Open Maturity Assessment',
            ctaUrl: `${APP_BASE_URL}/maturity`,
          }),
        });
        sent.push({ userId: c.userId, name: c.name });
      } catch (err) {
        errors.push({ userId: c.userId, name: c.name, error: err.message });
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.round_invited', entityType: 'maturity_round', entityId: r.id, details: { sent: sent.length, skipped: skipped.length, errors: errors.length } });
    res.json({ configured: true, sent, skipped, errors });
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

  // Delete an assessment round entirely — e.g. a test round, or a cycle that was started
  // by mistake. Removes every response/score/benchmark/suggestion/snapshot recorded
  // against it. Actions raised in that round are kept (not deleted) but detached
  // (round_id set to NULL) so a promoted Task List task is never silently orphaned by
  // deleting the round it happened to be raised in. If the deleted round was the anchor,
  // the next-earliest closed round with benchmarks (if any) becomes the anchor.
  app.delete('/api/maturity/rounds/:id', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    db.prepare('UPDATE maturity_actions SET round_id = NULL WHERE round_id = ?').run(r.id);
    for (const t of ['maturity_responses', 'maturity_service_scores', 'maturity_consciousness_scores', 'maturity_benchmarks', 'maturity_descriptor_suggestions', 'maturity_question_suggestions', 'maturity_round_snapshots']) {
      db.prepare(`DELETE FROM ${t} WHERE round_id = ?`).run(r.id);
    }
    db.prepare('DELETE FROM maturity_rounds WHERE id = ?').run(r.id);
    if (r.is_anchor) {
      const next = db.prepare(
        `SELECT mr.id FROM maturity_rounds mr WHERE mr.status = 'closed' AND EXISTS (SELECT 1 FROM maturity_benchmarks mb WHERE mb.round_id = mr.id)
         ORDER BY COALESCE(mr.closed_at, mr.created_at) ASC LIMIT 1`
      ).get();
      if (next) db.prepare('UPDATE maturity_rounds SET is_anchor = 1 WHERE id = ?').run(next.id);
    }
    logAudit({ userId: req.session.userId, action: 'maturity.round_deleted', entityType: 'maturity_round', entityId: r.id, details: { label: r.label, status: r.status } });
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
    const prevRoundId = previousClosedRoundId(roundId);
    return {
      round: roundRowToJson(r),
      groups: db.prepare('SELECT id, name, sort_order FROM maturity_service_groups ORDER BY sort_order').all(),
      levelLabels: levelLabels(),
      services,
      consciousnessLevels: ccLevels(),
      consciousnessStatements: ccStatements(),
      consciousness: { summary: consciousnessRoundSummary(roundId), prevSummary: consciousnessRoundSummary(prevRoundId) },
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
  // '0'/'false' turns it off; anything else (including absent, for old links/bookmarks) keeps
  // the report's default of showing the benchmark.
  function wantsBenchmark(v) {
    return v !== '0' && v !== 0 && v !== false && v !== 'false';
  }
  app.get('/api/maturity/report/pdf', requireAuth, async (req, res) => {
    const rid = reportRoundId(req.query);
    if (!rid) return res.status(404).json({ error: 'No round to report on yet.' });
    try {
      const pdf = await buildMaturityReportPdf(buildRoundModel(rid), { showBenchmark: wantsBenchmark(req.query.benchmark) });
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
      const pdf = await buildMaturityReportPdf(buildRoundModel(rid), { showBenchmark: wantsBenchmark(b.benchmark) });
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

  // Edit the wording of one of the 7 Capital Consciousness self-assessment statements
  // (§5.8) — admin-only, same pattern as level-labels/cc-levels above.
  app.put('/api/maturity/cc-statements/:level', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const level = Number(req.params.level);
    if (level < 1 || level > 7) return res.status(400).json({ error: 'level must be 1..7' });
    const cur = db.prepare('SELECT * FROM maturity_consciousness_statements WHERE level = ?').get(level);
    if (!cur) return res.status(404).json({ error: 'Statement not found' });
    const b = req.body || {};
    const statement = b.statement != null ? String(b.statement).trim() : cur.statement;
    if (!statement) return res.status(400).json({ error: 'statement is required' });
    db.prepare('UPDATE maturity_consciousness_statements SET statement = ? WHERE level = ?').run(statement, level);
    logAudit({ userId: req.session.userId, action: 'maturity.cc_statement_edited', entityType: 'maturity_consciousness_statement', entityId: String(level) });
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
    const familyContextWithActivity = [FAMILY_CONTEXT, recentGovernanceActivity()].filter(Boolean).join('\n\n');
    for (const s of targets) {
      try {
        const stat = serviceStats(r.id, s.id);
        const description = [s.description || '', liveEvidenceFor(s.id)].filter(Boolean).join('\n\n');
        const { result, usage } = await claude.benchmarkMaturityService({
          serviceName: s.name,
          description,
          levelLabels: labels,
          levelDescriptors: descriptorsFor(s.id).map((d) => d.text),
          familyContext: familyContextWithActivity,
          selfAssessedLevel: stat.mean,
        });
        logApiUsage({ callType: 'maturity_benchmark', usage, userId: req.session.userId });
        const peerLevel = clampLevel(Math.round((Number(result.peerLevel) || 3) * 2) / 2) ?? 3;
        const assessedLevel = clampLevel(Math.round((Number(result.assessedLevel) || 0) * 2) / 2);
        const priority = ['Immediate', 'Active', 'Monitor', 'Maintain'].includes(result.recommendedPriority) ? result.recommendedPriority : 'Monitor';
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO maturity_benchmarks (id, round_id, service_id, peer_level, peer_rationale, assessed_level, assessed_rationale, recommended_priority, recommendation, what_would_move_up, sources, caveats, model, searched_by, searched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id, service_id) DO UPDATE SET peer_level = excluded.peer_level, peer_rationale = excluded.peer_rationale,
             assessed_level = excluded.assessed_level, assessed_rationale = excluded.assessed_rationale,
             recommended_priority = excluded.recommended_priority, recommendation = excluded.recommendation,
             what_would_move_up = excluded.what_would_move_up, sources = excluded.sources, caveats = excluded.caveats,
             model = excluded.model, searched_by = excluded.searched_by, searched_at = excluded.searched_at`
        ).run(
          crypto.randomUUID(), r.id, s.id, peerLevel, String(result.peerRationale || ''),
          assessedLevel, String(result.assessedRationale || ''),
          priority, String(result.recommendation || ''),
          JSON.stringify(Array.isArray(result.whatWouldMoveUp) ? result.whatWouldMoveUp : []),
          JSON.stringify(Array.isArray(result.sources) ? result.sources : []),
          String(result.caveats || ''), 'claude-sonnet-5', req.session.userId, now
        );
        results.push({ serviceId: s.id, peerLevel, assessedLevel, recommendedPriority: priority });
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
      return { name: s.name, category: g ? g.name : '', familyMean: st.mean, assessedLevel: b ? b.assessedLevel : null, peerLevel: b ? b.peerLevel : null, prevFamilyMean: prev };
    });
    const lvlNames = ccLevels();
    const ccSummary = consciousnessRoundSummary(r.id);
    const ccPrevSummary = consciousnessRoundSummary(prevId);
    try {
      const { result, usage } = await claude.synthesizeMaturityRound({
        services,
        consciousness: {
          scale: lvlNames.map((l) => `${l.level} ${l.name} (${l.tagline})`),
          centerOfGravity: ccSummary.cog,
          previousCenterOfGravity: ccPrevSummary.cog,
          spread: ccSummary.spread,
          straddlesThreshold: ccSummary.straddlesThreshold,
          members: ccSummary.members,
        },
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

  // Researches how a specific service ought to be assessed and proposes refreshed wording
  // for BOTH its five level descriptors AND its four assessment questions in one pass —
  // the questions used to stay a fully standardized template reused across all 16
  // services (only the service name substituted in); this tailors them to what the
  // research turns up for that particular service. Nothing is applied without an admin
  // reviewing and accepting each suggestion (see the accept/dismiss routes below).
  app.post('/api/maturity/rounds/:id/suggest-wording', requireAuth, async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    if (r.status === 'closed') return res.status(400).json({ error: 'Wording suggestions can\'t be run against a closed round — start or open a new one first.' });
    const only = (req.body || {}).serviceId;
    const targets = only ? servicesList(true).filter((s) => s.id === only) : servicesList(false);
    const labels = levelLabels().map((l) => l.name);
    const results = [];
    const errors = [];
    const familyContextWithActivity = [FAMILY_CONTEXT, recentGovernanceActivity()].filter(Boolean).join('\n\n');
    for (const s of targets) {
      try {
        const current = descriptorsFor(s.id);
        const currentQuestions = questionsFor(s.id, false); // already ordered by sort_order
        const description = [s.description || '', liveEvidenceFor(s.id)].filter(Boolean).join('\n\n');
        const { result, usage } = await claude.suggestServiceWording({
          serviceName: s.name, description,
          levelLabels: labels, currentDescriptors: current.map((d) => d.text),
          currentQuestions, familyContext: familyContextWithActivity,
        });
        logApiUsage({ callType: 'maturity_wording_suggest', usage, userId: req.session.userId });
        const now = new Date().toISOString();

        db.prepare('DELETE FROM maturity_descriptor_suggestions WHERE round_id = ? AND service_id = ?').run(r.id, s.id);
        const insDesc = db.prepare(
          `INSERT INTO maturity_descriptor_suggestions (id, round_id, service_id, level, current_text, suggested_text, rationale, sources, status, model, searched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        );
        const levels = Array.isArray(result.levels) ? result.levels : [];
        for (const lv of levels) {
          const level = Number(lv.level);
          if (![1, 2, 3, 4, 5].includes(level)) continue;
          const curText = (current.find((d) => d.level === level) || {}).text || '';
          insDesc.run(crypto.randomUUID(), r.id, s.id, level, curText, String(lv.suggestedText || curText), String(lv.rationale || ''), JSON.stringify(Array.isArray(result.sources) ? result.sources : []), 'claude-sonnet-5', now);
        }

        db.prepare('DELETE FROM maturity_question_suggestions WHERE round_id = ? AND service_id = ?').run(r.id, s.id);
        const insQ = db.prepare(
          `INSERT INTO maturity_question_suggestions (id, round_id, service_id, question_id, current_prompt, current_help_text, suggested_prompt, suggested_help_text, rationale, sources, status, model, searched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        );
        const questions = Array.isArray(result.questions) ? result.questions : [];
        for (const qs of questions) {
          const sortOrder = Number(qs.sortOrder);
          const target = currentQuestions.find((q) => q.sortOrder === sortOrder);
          if (!target) continue; // Claude returned a slot that doesn't match a real question — skip rather than guess
          insQ.run(
            crypto.randomUUID(), r.id, s.id, target.id, target.prompt, target.helpText || '',
            String(qs.suggestedPrompt || target.prompt), String(qs.suggestedHelpText ?? target.helpText ?? ''),
            String(qs.rationale || ''), JSON.stringify(Array.isArray(result.sources) ? result.sources : []), 'claude-sonnet-5', now
          );
        }
        results.push({ serviceId: s.id, levels: levels.length, questions: questions.length });
      } catch (err) {
        if (err instanceof claude.ClaudeNotConfiguredError) return res.json({ configured: false });
        errors.push({ serviceId: s.id, error: err.message });
      }
    }
    logAudit({ userId: req.session.userId, action: 'maturity.wording_suggested', entityType: 'maturity_round', entityId: r.id, details: { count: results.length } });
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

  app.post('/api/maturity/question-suggestions/:id/accept', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sug = db.prepare('SELECT * FROM maturity_question_suggestions WHERE id = ?').get(req.params.id);
    if (!sug) return res.status(404).json({ error: 'Suggestion not found' });
    const b = req.body || {};
    const prompt = (b.prompt != null ? b.prompt : sug.suggested_prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'prompt is empty' });
    const helpText = (b.helpText != null ? b.helpText : sug.suggested_help_text || '').trim();
    const edited = prompt !== sug.suggested_prompt || helpText !== (sug.suggested_help_text || '');
    const now = new Date().toISOString();
    db.prepare('UPDATE maturity_questions SET prompt = ?, help_text = ? WHERE id = ?').run(prompt, helpText, sug.question_id);
    db.prepare('UPDATE maturity_question_suggestions SET status = ?, applied_prompt = ?, applied_help_text = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run(edited ? 'accepted_edited' : 'accepted', prompt, helpText, req.session.userId, now, sug.id);
    logAudit({ userId: req.session.userId, action: 'maturity.question_wording_accepted', entityType: 'maturity_question', entityId: sug.question_id, details: { serviceId: sug.service_id, edited } });
    res.json({ ok: true });
  });

  app.post('/api/maturity/question-suggestions/:id/dismiss', requireAuth, (req, res) => {
    if (!requireAdmin(req, res)) return;
    const sug = db.prepare('SELECT * FROM maturity_question_suggestions WHERE id = ?').get(req.params.id);
    if (!sug) return res.status(404).json({ error: 'Suggestion not found' });
    db.prepare('UPDATE maturity_question_suggestions SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run('dismissed', req.session.userId, new Date().toISOString(), sug.id);
    res.json({ ok: true });
  });

  // Every pending level-wording and question-wording suggestion for a round, across all
  // 16 services in one call — feeds a single "review" list on the Manage tab, instead of
  // requiring an admin to open each service's drawer individually to find them.
  app.get('/api/maturity/rounds/:id/wording-suggestions', requireAuth, (req, res) => {
    const r = getRound(req.params.id);
    if (!r) return res.status(404).json({ error: 'Round not found' });
    const descriptors = db.prepare(
      `SELECT ds.*, s.number AS service_number, s.name AS service_name FROM maturity_descriptor_suggestions ds
       JOIN maturity_services s ON s.id = ds.service_id
       WHERE ds.round_id = ? AND ds.status = 'pending' ORDER BY s.number, ds.level`
    ).all(r.id).map((row) => ({
      id: row.id, serviceId: row.service_id, serviceNumber: row.service_number, serviceName: row.service_name,
      level: row.level, currentText: row.current_text, suggestedText: row.suggested_text,
      rationale: row.rationale, sources: jsonParse(row.sources, []),
    }));
    const questions = db.prepare(
      `SELECT qs.*, s.number AS service_number, s.name AS service_name FROM maturity_question_suggestions qs
       JOIN maturity_services s ON s.id = qs.service_id
       WHERE qs.round_id = ? AND qs.status = 'pending' ORDER BY s.number`
    ).all(r.id).map((row) => ({
      id: row.id, serviceId: row.service_id, serviceNumber: row.service_number, serviceName: row.service_name,
      questionId: row.question_id, currentPrompt: row.current_prompt, currentHelpText: row.current_help_text,
      suggestedPrompt: row.suggested_prompt, suggestedHelpText: row.suggested_help_text,
      rationale: row.rationale, sources: jsonParse(row.sources, []),
    }));
    res.json({ descriptors, questions });
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
