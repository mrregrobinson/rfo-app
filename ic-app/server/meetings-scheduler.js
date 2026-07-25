// Meetings module — invite scheduler + minutes-email builder (build spec Sections 6.3
// and 7.2). The invite sweep follows the exact hourly setInterval pattern already used
// by server/digest.js; the minutes email is sent synchronously from the "mark complete"
// / "resend minutes" actions in server/meetings.js rather than on a schedule, since it's
// a one-off admin-triggered event, not a recurring cadence.
const mailer = require('./mailer');
const { buildMeetingIcs } = require('./ics');
const { BRAND, escapeHtml, contentRow, infoRow, sectionLabel, paragraph, bulletList, emailShell } = require('./email-template');

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';
const MS_GRAPH_SENDER = process.env.MS_GRAPH_SENDER;

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

function agendaPlainTextForInvite(agendaItems) {
  if (agendaItems.length === 0) return 'No agenda items yet.';
  return 'Agenda:\n' + agendaItems.map((a) => `- ${a.title}`).join('\n');
}

// Emails a hand-built .ics meeting request to family attendees only (Section 7.2 —
// external attendees are never auto-invited by the app) — see server/ics.js for why
// this doesn't go through the Graph Calendar API. Throws mailer.MailNotConfiguredError
// if Graph isn't configured; callers decide whether that should be swallowed (the
// hourly sweep does) or surfaced (the admin "Send invite now" button does, so the admin
// sees why nothing happened). Per-recipient send failures (once mail is confirmed
// configured) are logged and don't block the rest of the list, matching sendMinutesEmail.
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

  const icsContent = buildMeetingIcs({
    uid: `${meeting.id}@rfo.quaysolutions.ca`,
    sequence: meeting.ics_sequence,
    method: 'REQUEST',
    organizerEmail: MS_GRAPH_SENDER,
    organizerName: 'Robinson Family Office',
    attendees: attendees.map((a) => ({ name: a.name, email: a.email })),
    title: meeting.title,
    startDate: start,
    endDate: end,
    descriptionText: agendaPlainTextForInvite(agendaItems),
  });
  const icsAttachment = {
    // Bare MIME type, no parameters — the attachment's contentType field is meant to be
    // a simple type/subtype; METHOD:REQUEST already lives inside the .ics content itself
    // (Graph's fileAttachment schema isn't a full Content-Type header, and some clients,
    // Outlook's own .ics importer included, are pickier about extra parameters here than
    // Gmail/Google Calendar are).
    name: 'invite.ics',
    contentType: 'text/calendar',
    contentBase64: Buffer.from(icsContent, 'utf8').toString('base64'),
  };
  const dateStr = start.toLocaleString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const html = emailShell({
    eyebrow: 'Meeting Invite',
    title: meeting.title,
    subtitle: dateStr,
    bodyRowsHtml: contentRow(
      agendaItems.length
        ? sectionLabel('Agenda') + bulletList(agendaItems.map((a) => escapeHtml(a.title)))
        : paragraph('No agenda items yet.')
    ),
    ctaText: 'Open in Family Office Meetings',
    ctaUrl: `${APP_BASE_URL}/meetings?meeting=${meeting.id}`,
    footerText: 'A calendar invite is attached — open it to add this meeting to your calendar.',
  });

  let sentTo = 0;
  for (const attendee of attendees) {
    try {
      await mailer.sendMail({ to: attendee.email, subject: meeting.title, html, attachments: [icsAttachment] });
      sentTo += 1;
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) throw err; // Not configured at all — surface immediately.
      console.error(`Failed to send meeting invite to ${attendee.email}:`, err.message);
    }
  }
  db.prepare('UPDATE meetings SET invite_sent_at = ?, ics_sequence = ics_sequence + 1 WHERE id = ?').run(new Date().toISOString(), meetingId);
  return { sent: true, sentTo };
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

function agendaItemHtml(item, decisions, actionItems) {
  const familyItems = actionItems.filter((a) => a.isFamily);
  const nonFamilyItems = actionItems.filter((a) => !a.isFamily);
  const parts = [`<div style="font-size:15px;font-weight:700;color:${BRAND.navy};margin-bottom:6px;">${escapeHtml(item.title)}</div>`];
  parts.push(
    item.discussion_summary
      ? `<p style="margin:0 0 4px;font-size:13px;line-height:1.6;color:#374151;">${escapeHtml(item.discussion_summary)}</p>`
      : `<p style="margin:0 0 4px;font-size:13px;color:${BRAND.muted};font-style:italic;">No discussion summary recorded.</p>`
  );
  if (decisions.length) {
    parts.push(sectionLabel('Decisions'));
    parts.push(`<ul style="margin:0 0 4px;padding-left:20px;font-size:13px;">${decisions.map((d) => `<li style="margin-bottom:4px;">${escapeHtml(d.description)}</li>`).join('')}</ul>`);
  }
  if (familyItems.length) {
    parts.push(sectionLabel('Family action items'));
    parts.push(`<div style="font-size:13px;">${actionItemListHtml(familyItems, { showQuarter: true })}</div>`);
  }
  if (nonFamilyItems.length) {
    parts.push(sectionLabel('Other action items'));
    parts.push(`<div style="font-size:13px;">${actionItemListHtml(nonFamilyItems)}</div>`);
  }
  return contentRow(parts.join(''));
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
  const bodyRowsHtml = infoRow('Attendees', attendeeNames) + (sections || contentRow(`<span style="font-size:13px;color:${BRAND.muted};">No agenda items were recorded.</span>`));
  return emailShell({
    eyebrow: 'Meeting Minutes',
    title: meeting.title,
    subtitle: dateStr,
    bodyRowsHtml,
    ctaText: 'Open in Family Office Meetings',
    ctaUrl: `${APP_BASE_URL}/meetings?meeting=${meeting.id}`,
    footerText: 'This is an automated summary of the minutes recorded for this meeting. Reply to a family member directly with any corrections.',
  });
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
