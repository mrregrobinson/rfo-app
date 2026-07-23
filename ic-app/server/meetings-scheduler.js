// Meetings module — invite scheduler + minutes-email builder (build spec Sections 6.3
// and 7.2). The invite sweep follows the exact hourly setInterval pattern already used
// by server/digest.js; the minutes email is sent synchronously from the "mark complete"
// / "resend minutes" actions in server/meetings.js rather than on a schedule, since it's
// a one-off admin-triggered event, not a recurring cadence.
const mailer = require('./mailer');
const graphCalendar = require('./graph-calendar');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';

function familyAttendeesWithEmail(db, meetingId) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email FROM meeting_attendees ma
       JOIN users u ON u.id = ma.user_id
       WHERE ma.meeting_id = ? AND ma.user_id IS NOT NULL AND u.email IS NOT NULL AND u.email != ''`
    )
    .all(meetingId);
}

function agendaHtmlForInvite(agendaItems) {
  if (agendaItems.length === 0) return '<p>No agenda items yet.</p>';
  return `<p>Agenda:</p><ul>${agendaItems.map((a) => `<li>${escapeHtml(a.title)}</li>`).join('')}</ul>`;
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Creates the Graph Teams meeting and emails invites to family attendees only (Section
// 7.2 — external attendees are never auto-invited by the app). Throws
// mailer.MailNotConfiguredError if Graph isn't configured; callers decide whether that
// should be swallowed (the hourly sweep does) or surfaced (the admin "Send invite now"
// button does, so the admin sees why nothing happened).
async function sendMeetingInvite(db, meetingId) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  const attendees = familyAttendeesWithEmail(db, meetingId);
  if (attendees.length === 0) {
    return { sent: false, reason: 'No family attendees with an email address on file.' };
  }
  const agendaItems = db.prepare('SELECT title FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order').all(meetingId);
  const start = new Date(meeting.planned_at);
  const end = new Date(start.getTime() + meeting.duration_minutes * 60000);
  const { eventId, joinUrl } = await graphCalendar.createTeamsMeeting({
    subject: meeting.title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    attendeeEmails: attendees.map((a) => a.email),
    agendaHtml: agendaHtmlForInvite(agendaItems),
  });
  db.prepare('UPDATE meetings SET invite_sent_at = ?, graph_event_id = ?, teams_join_url = ? WHERE id = ?').run(
    new Date().toISOString(),
    eventId,
    joinUrl,
    meetingId
  );
  return { sent: true, joinUrl };
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function sweepDueInvites(db) {
  const due = db
    .prepare(
      `SELECT id FROM meetings
       WHERE status = 'planned' AND invite_send_date IS NOT NULL AND invite_send_date <= ? AND invite_sent_at IS NULL`
    )
    .all(todayDateStr());
  for (const row of due) {
    try {
      await sendMeetingInvite(db, row.id);
    } catch (err) {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        console.error(`Failed to send meeting invite for ${row.id}:`, err.message);
      }
    }
  }
}

function startMeetingsScheduler(db) {
  async function check() {
    try {
      await sweepDueInvites(db);
    } catch (err) {
      console.error('Meetings invite scheduler error:', err.message);
    }
  }
  check();
  setInterval(check, 60 * 60 * 1000);
}

// ---- minutes email (Section 6.3) ----

function agendaItemHtml(item, decisions, actionItems) {
  const familyItems = actionItems.filter((a) => a.is_family);
  const nonFamilyItems = actionItems.filter((a) => !a.is_family);
  const parts = [`<h3 style="margin:16px 0 6px;font-size:13px;color:#1B2A4A;">${escapeHtml(item.title)}</h3>`];
  if (item.discussion_summary) parts.push(`<p style="margin:0 0 8px;">${escapeHtml(item.discussion_summary)}</p>`);
  if (decisions.length) {
    parts.push(
      `<p style="margin:0 0 2px;font-weight:600;">Decisions</p><ul style="margin:0 0 8px;padding-left:18px;">${decisions
        .map((d) => `<li>${escapeHtml(d.description)}</li>`)
        .join('')}</ul>`
    );
  }
  if (familyItems.length) {
    parts.push(
      `<p style="margin:0 0 2px;font-weight:600;">Family action items</p><ul style="margin:0 0 8px;padding-left:18px;">${familyItems
        .map((a) => `<li>${escapeHtml(a.description)}${a.assignee_name ? ` — ${escapeHtml(a.assignee_name)}` : ''}</li>`)
        .join('')}</ul>`
    );
  }
  if (nonFamilyItems.length) {
    parts.push(
      `<p style="margin:0 0 2px;font-weight:600;">Other action items</p><ul style="margin:0 0 8px;padding-left:18px;">${nonFamilyItems
        .map((a) => `<li>${escapeHtml(a.description)}${a.assignee_name ? ` — ${escapeHtml(a.assignee_name)}` : ''}</li>`)
        .join('')}</ul>`
    );
  }
  return parts.join('');
}

function buildMinutesHtml(meeting, agendaItemsWithDetail) {
  const dateStr = new Date(meeting.planned_at).toLocaleString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const sections = agendaItemsWithDetail.map(({ item, decisions, actionItems }) => agendaItemHtml(item, decisions, actionItems)).join('');
  const body = sections || '<p>No agenda items were recorded.</p>';
  return `<p>Minutes from <strong>${escapeHtml(meeting.title)}</strong> (${dateStr}):</p>${body}<p style="margin-top:16px;"><a href="${APP_BASE_URL}/meetings?meeting=${meeting.id}">Open in Family Office Meetings</a></p>`;
}

function meetingMinutesDetail(db, meetingId) {
  const agendaItems = db.prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order').all(meetingId);
  return agendaItems.map((item) => ({
    item,
    decisions: db.prepare('SELECT * FROM meeting_decisions WHERE agenda_item_id = ? ORDER BY created_at').all(item.id),
    actionItems: db.prepare('SELECT * FROM meeting_action_items WHERE agenda_item_id = ? ORDER BY created_at').all(item.id),
  }));
}

// Sends the finished minutes to every family attendee and stamps minutes_emailed_at.
// Used both by "mark complete" (first send) and "resend minutes" (Section 6.3) — an
// admin editing a completed meeting's minutes does not auto-resend; they must call this
// again explicitly.
async function sendMinutesEmail(db, meetingId) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  const html = buildMinutesHtml(meeting, meetingMinutesDetail(db, meetingId));
  const attendees = familyAttendeesWithEmail(db, meetingId);
  let sentTo = 0;
  for (const attendee of attendees) {
    try {
      await mailer.sendMail({ to: attendee.email, subject: `Minutes: ${meeting.title}`, html });
      sentTo += 1;
    } catch (err) {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        console.error(`Failed to email minutes to ${attendee.email}:`, err.message);
      } else {
        throw err; // Not configured at all — surface to the admin action that called this.
      }
    }
  }
  db.prepare('UPDATE meetings SET minutes_emailed_at = ? WHERE id = ?').run(new Date().toISOString(), meetingId);
  return { sentTo };
}

module.exports = { startMeetingsScheduler, sweepDueInvites, sendMeetingInvite, sendMinutesEmail };
