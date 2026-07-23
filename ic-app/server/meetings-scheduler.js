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

// All planned attendees (family + external), for display in the minutes email header —
// distinct from familyAttendeesWithEmail above, which is who the email actually sends to.
function allAttendeeNames(db, meetingId) {
  const rows = db.prepare('SELECT * FROM meeting_attendees WHERE meeting_id = ?').all(meetingId);
  return rows.map((row) => {
    if (row.user_id) {
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(row.user_id);
      return { name: user ? user.name : row.user_id };
    }
    return { name: `${row.external_name} (external)` };
  });
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

// Robinson Family Office brand palette, matching the app's own CSS variables
// (public/*.html :root{--navy...}), so the emailed minutes look like part of the same
// product rather than a generic system notification.
const BRAND = { navy: '#1B2A4A', teal: '#2A7D7B', gold: '#C9A84C', muted: '#6B7280', border: '#E5E7EB', bg: '#F9FAFB' };

function quarterBadgeHtml(targetQuarter) {
  if (!targetQuarter) return '';
  return `<span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${BRAND.navy};background:#E8ECF3;">${escapeHtml(targetQuarter)}</span>`;
}

const PRIORITY_BADGE_COLORS = {
  high: { bg: '#FEE2E2', fg: '#991B1B' },
  medium: { bg: '#FEF3C7', fg: '#92400E' },
  low: { bg: '#D1FAE5', fg: '#065F46' },
};

function priorityBadgeHtml(priority) {
  const colors = PRIORITY_BADGE_COLORS[priority];
  if (!colors) return '';
  return `<span style="display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${colors.fg};background:${colors.bg};">${escapeHtml(priority)}</span>`;
}

function actionItemListHtml(items, { showQuarter } = {}) {
  return `<ul style="margin:0 0 4px;padding-left:20px;">${items
    .map(
      (a) =>
        `<li style="margin-bottom:4px;">${escapeHtml(a.description)}${a.assigneeDisplayName ? ` <span style="color:${BRAND.muted};">— ${escapeHtml(a.assigneeDisplayName)}</span>` : ''}${
          showQuarter ? priorityBadgeHtml(a.priority) + quarterBadgeHtml(a.targetQuarter) : ''
        }</li>`
    )
    .join('')}</ul>`;
}

function sectionLabelHtml(label) {
  return `<div style="font-size:11px;font-weight:700;color:${BRAND.teal};text-transform:uppercase;letter-spacing:.4px;margin:12px 0 4px;">${label}</div>`;
}

function agendaItemHtml(item, decisions, actionItems) {
  const familyItems = actionItems.filter((a) => a.isFamily);
  const nonFamilyItems = actionItems.filter((a) => !a.isFamily);
  const parts = [
    `<tr><td style="padding:18px 24px 4px;border-top:1px solid ${BRAND.border};">`,
    `<div style="font-size:15px;font-weight:700;color:${BRAND.navy};margin-bottom:6px;">${escapeHtml(item.title)}</div>`,
  ];
  parts.push(
    item.discussion_summary
      ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#374151;">${escapeHtml(item.discussion_summary)}</p>`
      : `<p style="margin:0 0 4px;font-size:13px;color:${BRAND.muted};font-style:italic;">No discussion summary recorded.</p>`
  );
  if (decisions.length) {
    parts.push(sectionLabelHtml('Decisions'));
    parts.push(`<ul style="margin:0 0 4px;padding-left:20px;font-size:13px;">${decisions.map((d) => `<li style="margin-bottom:4px;">${escapeHtml(d.description)}</li>`).join('')}</ul>`);
  }
  if (familyItems.length) {
    parts.push(sectionLabelHtml('Family action items'));
    parts.push(`<div style="font-size:13px;">${actionItemListHtml(familyItems, { showQuarter: true })}</div>`);
  }
  if (nonFamilyItems.length) {
    parts.push(sectionLabelHtml('Other action items'));
    parts.push(`<div style="font-size:13px;">${actionItemListHtml(nonFamilyItems)}</div>`);
  }
  parts.push('</td></tr>');
  return parts.join('');
}

function buildMinutesHtml(meeting, attendees, agendaItemsWithDetail) {
  const dateStr = new Date(meeting.planned_at).toLocaleString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const attendeeNames = attendees.map((a) => escapeHtml(a.name)).join(', ') || 'None listed';
  const sections = agendaItemsWithDetail.map(({ item, decisions, actionItems }) => agendaItemHtml(item, decisions, actionItems)).join('');
  const body = sections || `<tr><td style="padding:18px 24px;border-top:1px solid ${BRAND.border};font-size:13px;color:${BRAND.muted};">No agenda items were recorded.</td></tr>`;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <tr><td style="background:${BRAND.navy};padding:20px 24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND.gold};margin-bottom:6px;">Robinson Family Office · Meeting Minutes</div>
        <div style="font-size:19px;font-weight:700;color:#ffffff;">${escapeHtml(meeting.title)}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:4px;">${dateStr}</div>
      </td></tr>
      <tr><td style="padding:14px 24px;border-bottom:1px solid ${BRAND.border};">
        <div style="font-size:11px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">Attendees</div>
        <div style="font-size:13px;color:#374151;">${attendeeNames}</div>
      </td></tr>
      ${body}
      <tr><td style="padding:20px 24px;background:${BRAND.bg};">
        <a href="${APP_BASE_URL}/meetings?meeting=${meeting.id}" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 18px;border-radius:7px;">Open in Family Office Meetings</a>
        <div style="font-size:11px;color:${BRAND.muted};margin-top:14px;">This is an automated summary of the minutes recorded for this meeting. Reply to a family member directly with any corrections.</div>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

function meetingMinutesDetail(db, meetingId) {
  const agendaItems = db.prepare('SELECT * FROM agenda_items WHERE meeting_id = ? ORDER BY sort_order').all(meetingId);
  return agendaItems.map((item) => {
    const actionItemRows = db.prepare('SELECT * FROM meeting_action_items WHERE agenda_item_id = ? ORDER BY created_at').all(item.id);
    const actionItems = actionItemRows.map((a) => {
      let assigneeDisplayName = a.assignee_name;
      let targetQuarter = null;
      let priority = null;
      if (a.is_family) {
        const user = a.assignee_user_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(a.assignee_user_id) : null;
        assigneeDisplayName = user ? user.name : null;
        const task = a.task_id ? db.prepare('SELECT target_quarter, priority FROM tasks WHERE id = ?').get(a.task_id) : null;
        targetQuarter = task ? task.target_quarter : null;
        priority = task ? task.priority : null;
      }
      return { description: a.description, isFamily: !!a.is_family, assigneeDisplayName, targetQuarter, priority };
    });
    return {
      item,
      decisions: db.prepare('SELECT * FROM meeting_decisions WHERE agenda_item_id = ? ORDER BY created_at').all(item.id),
      actionItems,
    };
  });
}

// Sends the finished minutes to every family attendee and stamps minutes_emailed_at.
// Used both by "mark complete" (first send) and "resend minutes" (Section 6.3) — an
// admin editing a completed meeting's minutes does not auto-resend; they must call this
// again explicitly.
async function sendMinutesEmail(db, meetingId) {
  const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
  if (!meeting) throw new Error('Meeting not found');
  const html = buildMinutesHtml(meeting, allAttendeeNames(db, meetingId), meetingMinutesDetail(db, meetingId));
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
