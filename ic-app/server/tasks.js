// Shared Task List module routes — mounted onto the main app from index.js.
// Permission model (Section 4 of the build spec): tasks_role is one of
// admin / member / viewer, independent of dd_role and is_fo_admin. An FO admin is
// always also treated as a Task List admin (the FO role is a superset), matching how
// Reg/Sheri-Dawn are seeded in migration 012.
const crypto = require('node:crypto');
const { requireAuth } = require('./auth');
const { sendDigestToUser } = require('./digest');
const mailer = require('./mailer');

module.exports = function registerTaskRoutes(app, { db, logAudit }) {
  function myRoles(userId) {
    const row = db.prepare('SELECT is_fo_admin, tasks_role FROM users WHERE id = ?').get(userId);
    if (!row) return { isFoAdmin: false, tasksAdmin: false, tasksMember: false };
    const isFoAdmin = !!row.is_fo_admin;
    return {
      isFoAdmin,
      tasksAdmin: isFoAdmin || row.tasks_role === 'admin',
      tasksMember: isFoAdmin || row.tasks_role === 'admin' || row.tasks_role === 'member',
    };
  }

  function taskRowToJson(row) {
    const assigneeRows = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(row.id);
    const assignedToAll = assigneeRows.some((a) => a.user_id === null);
    return {
      id: row.id,
      categoryId: row.category_id,
      parentTaskId: row.parent_task_id,
      title: row.title,
      priority: row.priority,
      targetQuarter: row.target_quarter,
      targetDate: row.target_date,
      status: row.status,
      completedAt: row.completed_at,
      notes: row.notes,
      sourceRefId: row.source_ref_id,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedToAll,
      assigneeIds: assignedToAll ? [] : assigneeRows.map((a) => a.user_id),
    };
  }

  function canEditTask(row, userId, roles) {
    if (roles.tasksAdmin) return true;
    if (!roles.tasksMember) return false;
    const assigneeRows = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(row.id);
    return assigneeRows.some((a) => a.user_id === null || a.user_id === userId);
  }

  function setAssignees(taskId, assigneeIds, assignedToAll) {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    if (assignedToAll) {
      db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, NULL)').run(taskId);
    } else {
      for (const uid of assigneeIds || []) {
        db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, uid);
      }
    }
  }

  // ---- reference data ----

  app.get('/api/pillars-categories', requireAuth, (req, res) => {
    const pillars = db.prepare('SELECT * FROM pillars ORDER BY sort_order').all();
    const categories = db.prepare('SELECT * FROM task_categories ORDER BY sort_order').all();
    res.json({
      pillars: pillars.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sort_order })),
      categories: categories.map((c) => ({ id: c.id, pillarId: c.pillar_id, name: c.name, sortOrder: c.sort_order })),
    });
  });

  // ---- tasks ----
  // Every role (admin/member/viewer) sees the full list — Section 6.1: the list view is
  // the same for all roles, only edit/create/delete rights differ.

  app.get('/api/tasks', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksMember && !roles.tasksAdmin) {
      const row = db.prepare('SELECT tasks_role, is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
      if (!row) return res.status(403).json({ error: 'No Task List access' });
    }
    const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at').all();
    res.json(rows.map(taskRowToJson));
  });

  app.post('/api/tasks', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksMember) return res.status(403).json({ error: 'You do not have permission to add tasks' });
    const b = req.body || {};
    if (!b.title || !b.categoryId) return res.status(400).json({ error: 'title and categoryId are required' });
    const category = db.prepare('SELECT id FROM task_categories WHERE id = ?').get(b.categoryId);
    if (!category) return res.status(400).json({ error: 'Unknown categoryId' });

    // Members (not admins) may only create tasks assigned to themselves — Section 6.3:
    // "add a new task, assigned to themself (or to All)."
    let assignedToAll = !!b.assignedToAll;
    let assigneeIds = Array.isArray(b.assigneeIds) ? b.assigneeIds : [];
    if (!roles.tasksAdmin) {
      if (!assignedToAll) assigneeIds = [req.session.userId];
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO tasks (id, category_id, parent_task_id, title, priority, target_quarter, target_date, status, completed_at, notes, source_ref_id, created_by, created_at, updated_at)
       VALUES (@id, @categoryId, @parentTaskId, @title, @priority, @targetQuarter, @targetDate, 'open', NULL, @notes, NULL, @createdBy, @createdAt, @updatedAt)`
    ).run({
      id,
      categoryId: b.categoryId,
      parentTaskId: b.parentTaskId || null,
      title: b.title,
      priority: ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium',
      targetQuarter: b.targetQuarter || null,
      targetDate: b.targetDate || null,
      notes: b.notes || '',
      createdBy: req.session.userId,
      createdAt: now,
      updatedAt: now,
    });
    setAssignees(id, assigneeIds, assignedToAll);
    logAudit({ userId: req.session.userId, action: 'task.created', entityType: 'task', entityId: id, details: { title: b.title } });
    res.status(201).json(taskRowToJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)));
  });

  app.put('/api/tasks/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found' });
    const roles = myRoles(req.session.userId);
    if (!canEditTask(row, req.session.userId, roles)) {
      return res.status(403).json({ error: 'You can only edit your own tasks (or tasks assigned to All)' });
    }
    const b = req.body || {};
    const now = new Date().toISOString();
    const wasOpen = row.status === 'open';

    // Two ways to mark a task done: the row checkbox (quick toggle, sends `status` only
    // — defaults the completion date to today) or entering/editing an exact date in the
    // edit form (sends `completedAt` explicitly, which takes priority and derives status
    // from whether a date is present).
    let nextStatus, completedAt;
    if (b.completedAt !== undefined) {
      completedAt = b.completedAt || null;
      nextStatus = completedAt ? 'done' : 'open';
    } else {
      nextStatus = b.status && ['open', 'done'].includes(b.status) ? b.status : row.status;
      completedAt = nextStatus === 'done' ? (wasOpen ? now.slice(0, 10) : row.completed_at || now.slice(0, 10)) : null;
    }

    db.prepare(
      `UPDATE tasks SET
         title=@title, priority=@priority, target_quarter=@targetQuarter, target_date=@targetDate,
         status=@status, completed_at=@completedAt, notes=@notes, category_id=@categoryId, updated_at=@updatedAt
       WHERE id=@id`
    ).run({
      id: row.id,
      title: b.title ?? row.title,
      priority: b.priority && ['high', 'medium', 'low'].includes(b.priority) ? b.priority : row.priority,
      targetQuarter: b.targetQuarter !== undefined ? b.targetQuarter : row.target_quarter,
      targetDate: b.targetDate !== undefined ? b.targetDate : row.target_date,
      status: nextStatus,
      completedAt,
      notes: b.notes !== undefined ? b.notes : row.notes,
      categoryId: roles.tasksAdmin && b.categoryId ? b.categoryId : row.category_id,
      updatedAt: now,
    });
    // Reassigning to other members is an admin-only action — a member updating their own
    // task can change everything about it except who it's assigned to.
    if (roles.tasksAdmin && (b.assigneeIds !== undefined || b.assignedToAll !== undefined)) {
      setAssignees(row.id, b.assigneeIds || [], !!b.assignedToAll);
    }
    logAudit({ userId: req.session.userId, action: nextStatus === 'done' && wasOpen ? 'task.completed' : 'task.updated', entityType: 'task', entityId: row.id });
    res.json(taskRowToJson(db.prepare('SELECT * FROM tasks WHERE id = ?').get(row.id)));
  });

  app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksAdmin) return res.status(403).json({ error: 'Admin only' });
    const row = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Task not found' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    logAudit({ userId: req.session.userId, action: 'task.deleted', entityType: 'task', entityId: req.params.id, details: { title: row.title } });
    res.json({ ok: true });
  });

  // ---- digest settings (Task List admin only) ----

  const DIGEST_KEYS = ['task_digest_enabled', 'task_digest_cadence', 'task_digest_day_of_week', 'task_digest_day_of_month', 'task_digest_hour_local', 'task_digest_timezone', 'task_digest_last_sent_at'];

  function getDigestSettings() {
    const out = {};
    for (const key of DIGEST_KEYS) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      out[key] = row ? row.value : '';
    }
    return out;
  }

  app.get('/api/admin/settings/task-digest', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksAdmin) return res.status(403).json({ error: 'Task List admin only' });
    res.json(getDigestSettings());
  });

  app.put('/api/admin/settings/task-digest', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksAdmin) return res.status(403).json({ error: 'Task List admin only' });
    const b = req.body || {};
    if (!['daily', 'weekly', 'biweekly', 'monthly'].includes(b.cadence)) {
      return res.status(400).json({ error: 'cadence must be daily, weekly, biweekly, or monthly' });
    }
    const dayOfWeek = Number.isInteger(b.dayOfWeek) ? b.dayOfWeek : 1;
    const dayOfMonth = Number.isInteger(b.dayOfMonth) ? b.dayOfMonth : 1;
    const hourLocal = Number.isInteger(b.hourLocal) ? b.hourLocal : 8;
    const timezone = b.timezone || 'America/Toronto';
    const updates = {
      task_digest_enabled: b.enabled ? '1' : '0',
      task_digest_cadence: b.cadence,
      task_digest_day_of_week: String(dayOfWeek),
      task_digest_day_of_month: String(dayOfMonth),
      task_digest_hour_local: String(hourLocal),
      task_digest_timezone: timezone,
    };
    for (const [key, value] of Object.entries(updates)) {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(key, value);
    }
    logAudit({ userId: req.session.userId, action: 'admin.task_digest_settings_updated', entityType: 'setting', entityId: 'task_digest', details: updates });
    res.json(getDigestSettings());
  });

  // Sends the digest to the calling admin's own email right now, ignoring cadence/day/
  // hour and the enabled switch — lets an admin see exactly what the recurring email
  // will look like before turning it on for everyone (Section: digest test-send).
  app.post('/api/admin/settings/task-digest/test', requireAuth, async (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.tasksAdmin) return res.status(403).json({ error: 'Task List admin only' });
    try {
      const result = await sendDigestToUser(db, req.session.userId, { skipIfEmpty: false });
      logAudit({ userId: req.session.userId, action: 'admin.task_digest_test_sent', entityType: 'setting', entityId: 'task_digest' });
      res.json(result);
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) {
        return res.status(503).json({ error: 'Email is not configured on this server yet — set the MS_GRAPH_* environment variables first.' });
      }
      res.status(500).json({ error: err.message || 'Failed to send test email' });
    }
  });
};
