// Creates a real Outlook calendar event via the Graph Calendar API for the Meetings
// module's invite step (RFO_Meetings_App_BuildSpec_v1.docx, Section 7) — Graph creates
// the event and sends each attendee a standard calendar invite itself, so nothing needs
// to be hand-built for the email. Reuses server/mailer.js's app-only token
// (client-credentials against the same Azure App Registration). Requires that
// registration to also be granted the Calendars.ReadWrite application permission,
// admin-consented and scoped to MS_GRAPH_SENDER via the same Exchange Application Access
// Policy already used for Mail.Send — no new environment variables needed.
//
// Teams online-meeting provisioning (isOnlineMeeting/onlineMeetingProvider) is
// deliberately deferred: app-only Graph calls need a separate Microsoft Teams
// Application Access Policy (Teams PowerShell, not the Azure Portal) to actually
// provision the Teams meeting — without it, Graph silently creates a plain calendar
// event and drops those fields rather than erroring. Add them back here once that
// policy is in place.
const mailer = require('./mailer');

const SENDER = process.env.MS_GRAPH_SENDER;

// { subject, startIso, endIso, attendeeEmails, agendaHtml } -> { eventId }
async function createCalendarEvent({ subject, startIso, endIso, attendeeEmails, agendaHtml }) {
  const token = await mailer.getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/events`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      start: { dateTime: startIso, timeZone: 'UTC' },
      end: { dateTime: endIso, timeZone: 'UTC' },
      body: { contentType: 'HTML', content: agendaHtml },
      attendees: attendeeEmails.map((email) => ({ emailAddress: { address: email }, type: 'required' })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph create event failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { eventId: data.id };
}

module.exports = { createCalendarEvent };
