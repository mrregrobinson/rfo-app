// Family Office Meetings module routes — mounted onto the main app from index.js.
// Permission model (build spec Section 4): meetings_role is admin / member / viewer,
// independent of dd_role/tasks_role. An FO admin is always also treated as a Meetings
// admin. Per the family's confirmed answer on Section 4.1, scheduling a meeting and
// editing its plan (agenda/attendees/invite date) are member-level actions, not
// admin-only — only "send invite now", "mark complete", "resend minutes", and
// delete/cancel are admin-only.
const crypto = require('node:crypto');
const { requireAuth } = require('./auth');
const mailer = require('./mailer');
const { sendMeetingInvite, sendMinutesEmail } = require('./meetings-scheduler');

module.exports = function registerMeetingRoutes(app, { db, logAudit }) {
  function myRoles(userId) {
    const row = db.prepare('SELECT is_fo_admin, meetings_role FROM users WHERE id = ?').get(userId);
    if (!row) return { isFoAdmin: false, meetingsAdmin: false, meetingsMember: false };
    const isFoAdmin = !!row.is_fo_admin;
    return {
      isFoAdmin,
      meetingsAdmin: isFoAdmin || row.meetings_role === 'admin',
      meetingsMember: isFoAdmin || row.meetings_role === 'admin' || row.meetings_role === 'member',
    };
  }

  function attendeeRowToJson(row) {
    if (row.user_id) {
      const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(row.user_id);
      return { id: row.id, userId: row.user_id, name: user ? user.name : null, email: user ? user.email : null, external: false };
    }
    return { id: row.id, userId: null, name: row.external_name, email: row.external_email, external: true };
  }

  function decisionRowToJson(row) {
    return { id: row.id, agendaItemId: row.agenda_item_id, description: row.description, createdBy: row.created_by, createdAt: row.created_at };
  }

  function actionItemRowToJson(row) {
    // targetQuarter/priority live on the linked task (tasks.target_quarter/priority), not
    // duplicated onto this row — looked up here purely for display, so the minutes
    // UI/email can show what the person recording minutes picked for a family action item.
    const task = row.task_id ? db.prepare('SELECT target_quarter, priority FROM tasks WHERE id = ?').get(row.task_id) : null;
    return {
      id: row.id,
      agendaItemId: row.agenda_item_id,
      description: row.description,
      isFamily: !!row.is_family,
      assigneeUserId: row.assignee_user_id,
      assigneeName: row.assignee_name,
      taskId: row.task_id,
      targetQuarter: task ? task.target_quarter : null,
      priority: task ? task.priority : null,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  function agendaItemRowToJson(row, { withDetail } = {}) {
    const base = {
      id: row.id,
      meetingId: row.meeting_id,
      title: row.title,
      sortOrder: row.sort_order,
      discussionSummary: row.discussion_summary,
      addedDuringMinutes: !!row.added_during_minutes,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (!withDetail) return base;
    return {
      ...base,
      decisions: db.prepare('SELECT * FROM meeting_decisions WHERE agenda_item_id = ? ORDER BY created_at').all(row.id).map(decisionRowToJson),
      actionItems: db.prepare('SELECT * FROM meeting_action_items WHERE agenda_item_id = ? ORDER BY created_at').all(row.id).map(actionItemRowToJson),
    };
  }

  function meetingRowToJson(row) {
    return {
      id: row.id,
      title: row.title,
      plannedAt: row.planned_at,
      durationMinutes: row.duration_minutes,
      status: row.status,
      inviteSendDate: row.invite_send_date,
      inviteSentAt: row.invite_sent_at,
      teamsJoinUrl: row.teams_join_url,
      completedBy: row.completed_by,
      completedAt: row.completed_at,
      minutesEmailedAt: row.minutes_emailed_at,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function meetingDetailJson(row) {
    const attendees = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id = ?').all(row.id).map(attendeeRowToJson);
    const agendaItems = db
      .prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order')
      .all(row.id)
      .map((r) => agendaItemRowToJson(r, { withDetail: true }));
    return { ...meetingRowToJson(row), attendees, agendaItems };
  }

  function setAttendees(meetingId, attendees) {
    db.prepare('DELETE FROM meeting_attendees WHERE meeting_id = ?').run(meetingId);
    for (const a of attendees || []) {
      const id = crypto.randomUUID();
      if (a.userId) {
        db.prepare('INSERT INTO meeting_attendees (id, meeting_id, user_id) VALUES (?, ?, ?)').run(id, meetingId, a.userId);
      } else if (a.externalName) {
        db.prepare('INSERT INTO meeting_attendees (id, meeting_id, external_name, external_email) VALUES (?, ?, ?, ?)').run(
          id,
          meetingId,
          a.externalName,
          a.externalEmail || null
        );
      }
    }
  }

  function requireMeeting(req, res) {
    const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Meeting not found' });
      return null;
    }
    return row;
  }

  // ---- meetings ----

  app.get('/api/meetings', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'No Meetings access' });
    const rows = db.prepare('SELECT * FROM meetings ORDER BY planned_at DESC').all();
    res.json(rows.map(meetingRowToJson));
  });

  app.get('/api/meetings/:id', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'No Meetings access' });
    const row = requireMeeting(req, res);
    if (!row) return;
    res.json(meetingDetailJson(row));
  });

  app.post('/api/meetings', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to schedule meetings' });
    const b = req.body || {};
    if (!b.title || !b.plannedAt) return res.status(400).json({ error: 'title and plannedAt are required' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO meetings (id, title, planned_at, duration_minutes, status, invite_send_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?)`
    ).run(id, b.title, b.plannedAt, Number.isInteger(b.durationMinutes) ? b.durationMinutes : 60, b.inviteSendDate || null, req.session.userId, now, now);
    setAttendees(id, b.attendees);
    const agendaTitles = Array.isArray(b.agendaItems) ? b.agendaItems.filter((t) => t && t.trim()) : [];
    agendaTitles.forEach((title, i) => {
      db.prepare(
        `INSERT INTO agenda_items (id, meeting_id, title, sort_order, added_during_minutes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(crypto.randomUUID(), id, title.trim(), i, req.session.userId, now, now);
    });
    logAudit({ userId: req.session.userId, action: 'meeting.created', entityType: 'meeting', entityId: id, details: { title: b.title } });
    res.status(201).json(meetingDetailJson(db.prepare('SELECT * FROM meetings WHERE id = ?').get(id)));
  });

  app.put('/api/meetings/:id', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to edit this meeting' });
    const row = requireMeeting(req, res);
    if (!row) return;
    if (row.status !== 'planned') return res.status(400).json({ error: 'Only a planned meeting’s details can be edited' });
    const b = req.body || {};
    db.prepare(
      `UPDATE meetings SET title=@title, planned_at=@plannedAt, duration_minutes=@durationMinutes, invite_send_date=@inviteSendDate, updated_at=@updatedAt WHERE id=@id`
    ).run({
      id: row.id,
      title: b.title ?? row.title,
      plannedAt: b.plannedAt ?? row.planned_at,
      durationMinutes: Number.isInteger(b.durationMinutes) ? b.durationMinutes : row.duration_minutes,
      inviteSendDate: b.inviteSendDate !== undefined ? b.inviteSendDate || null : row.invite_send_date,
      updatedAt: new Date().toISOString(),
    });
    logAudit({ userId: req.session.userId, action: 'meeting.updated', entityType: 'meeting', entityId: row.id });
    res.json(meetingDetailJson(db.prepare('SELECT * FROM meetings WHERE id = ?').get(row.id)));
  });

  app.put('/api/meetings/:id/attendees', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to edit this meeting' });
    const row = requireMeeting(req, res);
    if (!row) return;
    setAttendees(row.id, (req.body || {}).attendees);
    logAudit({ userId: req.session.userId, action: 'meeting.attendees_updated', entityType: 'meeting', entityId: row.id });
    res.json(meetingDetailJson(db.prepare('SELECT * FROM meetings WHERE id = ?').get(row.id)));
  });

  app.delete('/api/meetings/:id', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsAdmin) return res.status(403).json({ error: 'Meetings admin only' });
    const row = requireMeeting(req, res);
    if (!row) return;
    db.prepare('DELETE FROM meetings WHERE id = ?').run(row.id);
    logAudit({ userId: req.session.userId, action: 'meeting.deleted', entityType: 'meeting', entityId: row.id, details: { title: row.title } });
    res.json({ ok: true });
  });

  // ---- agenda items ----

  app.post('/api/meetings/:id/agenda-items', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to edit this meeting' });
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    const b = req.body || {};
    if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM agenda_items WHERE meeting_id = ?').get(meeting.id).m;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Items added once the meeting is no longer just a plan (i.e. via this endpoint,
    // rather than as part of POST /api/meetings) count as added during minutes — Section
    // 6.2's "add new agenda items."
    db.prepare(
      `INSERT INTO agenda_items (id, meeting_id, title, sort_order, added_during_minutes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(id, meeting.id, b.title.trim(), (maxOrder ?? -1) + 1, req.session.userId, now, now);
    logAudit({ userId: req.session.userId, action: 'agenda_item.added', entityType: 'meeting', entityId: meeting.id, details: { title: b.title } });
    res.status(201).json(agendaItemRowToJson(db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(id), { withDetail: true }));
  });

  app.delete('/api/meetings/:id/agenda-items/:itemId', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to edit this meeting' });
    const item = db.prepare('SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ?').get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Agenda item not found' });
    db.prepare('DELETE FROM agenda_items WHERE id = ?').run(item.id);
    logAudit({ userId: req.session.userId, action: 'agenda_item.deleted', entityType: 'meeting', entityId: req.params.id, details: { title: item.title } });
    res.json({ ok: true });
  });

  // ---- minutes: discussion summary ----

  app.put('/api/meetings/:id/agenda-items/:itemId/summary', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to record minutes' });
    const item = db.prepare('SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ?').get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Agenda item not found' });
    const discussionSummary = (req.body || {}).discussionSummary || '';
    db.prepare('UPDATE agenda_items SET discussion_summary = ?, updated_at = ? WHERE id = ?').run(discussionSummary, new Date().toISOString(), item.id);
    res.json(agendaItemRowToJson(db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(item.id), { withDetail: true }));
  });

  // ---- minutes: decisions ----

  app.post('/api/meetings/:id/agenda-items/:itemId/decisions', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to record minutes' });
    const item = db.prepare('SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ?').get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Agenda item not found' });
    const description = ((req.body || {}).description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO meeting_decisions (id, agenda_item_id, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      item.id,
      description,
      req.session.userId,
      new Date().toISOString()
    );
    logAudit({ userId: req.session.userId, action: 'decision.added', entityType: 'meeting', entityId: req.params.id });
    res.status(201).json(decisionRowToJson(db.prepare('SELECT * FROM meeting_decisions WHERE id = ?').get(id)));
  });

  app.delete('/api/meetings/:id/decisions/:decisionId', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to record minutes' });
    const row = db.prepare('SELECT * FROM meeting_decisions WHERE id = ?').get(req.params.decisionId);
    if (!row) return res.status(404).json({ error: 'Decision not found' });
    db.prepare('DELETE FROM meeting_decisions WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // ---- minutes: action items ----
  // Saving a family action item immediately creates the linked Family Task List task
  // (Section 5.6) — the person recording minutes picks which of the existing task
  // categories it files under, per the family's confirmed answer.

  app.post('/api/meetings/:id/agenda-items/:itemId/action-items', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to record minutes' });
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    const item = db.prepare('SELECT * FROM agenda_items WHERE id = ? AND meeting_id = ?').get(req.params.itemId, req.params.id);
    if (!item) return res.status(404).json({ error: 'Agenda item not found' });
    const b = req.body || {};
    const description = (b.description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    const isFamily = !!b.isFamily;

    let taskId = null;
    if (isFamily) {
      if (!b.assigneeUserId) return res.status(400).json({ error: 'assigneeUserId is required for a family action item' });
      if (!b.categoryId) return res.status(400).json({ error: 'categoryId is required for a family action item' });
      const category = db.prepare('SELECT id FROM task_categories WHERE id = ?').get(b.categoryId);
      if (!category) return res.status(400).json({ error: 'Unknown categoryId' });
      const assignee = db.prepare('SELECT id FROM users WHERE id = ?').get(b.assigneeUserId);
      if (!assignee) return res.status(400).json({ error: 'Unknown assigneeUserId' });
      const priority = ['high', 'medium', 'low'].includes(b.priority) ? b.priority : 'medium';
      taskId = crypto.randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks (id, category_id, parent_task_id, title, priority, target_quarter, target_date, status, completed_at, notes, source_ref_id, created_by, created_at, updated_at)
         VALUES (?, ?, NULL, ?, ?, ?, NULL, 'open', NULL, ?, NULL, ?, ?, ?)`
      ).run(taskId, b.categoryId, description, priority, b.targetQuarter || null, `From: ${meeting.title} — agenda item "${item.title}."`, req.session.userId, now, now);
      db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(taskId, b.assigneeUserId);
      logAudit({ userId: req.session.userId, action: 'task.created', entityType: 'task', entityId: taskId, details: { title: description, fromMeetingId: meeting.id } });
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO meeting_action_items (id, agenda_item_id, description, is_family, assignee_user_id, assignee_name, task_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, item.id, description, isFamily ? 1 : 0, isFamily ? b.assigneeUserId : null, isFamily ? null : b.assigneeName || null, taskId, req.session.userId, new Date().toISOString());
    logAudit({ userId: req.session.userId, action: 'action_item.added', entityType: 'meeting', entityId: req.params.id, details: { isFamily } });
    res.status(201).json(actionItemRowToJson(db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(id)));
  });

  app.delete('/api/meetings/:id/action-items/:actionItemId', requireAuth, (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsMember) return res.status(403).json({ error: 'You do not have permission to record minutes' });
    const row = db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(req.params.actionItemId);
    if (!row) return res.status(404).json({ error: 'Action item not found' });
    // The linked Family Task List task (if any) is left in place even if the minutes
    // entry is removed — someone may already be acting on it.
    db.prepare('DELETE FROM meeting_action_items WHERE id = ?').run(row.id);
    res.json({ ok: true });
  });

  // ---- invite (admin only) ----

  app.post('/api/meetings/:id/send-invite', requireAuth, async (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsAdmin) return res.status(403).json({ error: 'Meetings admin only' });
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    try {
      const result = await sendMeetingInvite(db, meeting.id);
      logAudit({ userId: req.session.userId, action: 'meeting.invite_sent', entityType: 'meeting', entityId: meeting.id });
      res.json(result);
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) {
        return res.status(503).json({ error: 'Email/calendar is not configured on this server yet — set the MS_GRAPH_* environment variables first.' });
      }
      res.status(500).json({ error: err.message || 'Failed to send the meeting invite' });
    }
  });

  // ---- complete + distribute minutes (admin only) ----

  app.put('/api/meetings/:id/complete', requireAuth, async (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsAdmin) return res.status(403).json({ error: 'Meetings admin only' });
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    const now = new Date().toISOString();
    db.prepare("UPDATE meetings SET status = 'completed', completed_by = ?, completed_at = ?, updated_at = ? WHERE id = ?").run(
      req.session.userId,
      now,
      now,
      meeting.id
    );
    logAudit({ userId: req.session.userId, action: 'meeting.completed', entityType: 'meeting', entityId: meeting.id });
    try {
      const result = await sendMinutesEmail(db, meeting.id);
      res.json({ ...meetingDetailJson(db.prepare('SELECT * FROM meetings WHERE id = ?').get(meeting.id)), minutesEmail: result });
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) {
        return res.json({
          ...meetingDetailJson(db.prepare('SELECT * FROM meetings WHERE id = ?').get(meeting.id)),
          minutesEmailWarning: 'Meeting marked complete, but email is not configured on this server, so minutes were not sent.',
        });
      }
      res.status(500).json({ error: err.message || 'Meeting marked complete, but sending the minutes email failed.' });
    }
  });

  app.post('/api/meetings/:id/resend-minutes', requireAuth, async (req, res) => {
    const roles = myRoles(req.session.userId);
    if (!roles.meetingsAdmin) return res.status(403).json({ error: 'Meetings admin only' });
    const meeting = requireMeeting(req, res);
    if (!meeting) return;
    if (meeting.status !== 'completed') return res.status(400).json({ error: 'Only a completed meeting’s minutes can be (re)sent' });
    try {
      const result = await sendMinutesEmail(db, meeting.id);
      logAudit({ userId: req.session.userId, action: 'meeting.minutes_resent', entityType: 'meeting', entityId: meeting.id });
      res.json(result);
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) {
        return res.status(503).json({ error: 'Email is not configured on this server yet — set the MS_GRAPH_* environment variables first.' });
      }
      res.status(500).json({ error: err.message || 'Failed to resend minutes' });
    }
  });
};
