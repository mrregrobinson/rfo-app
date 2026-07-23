// Creates a real Microsoft Teams meeting via the Graph Calendar API for the Meetings
// module's invite step (RFO_Meetings_App_BuildSpec_v1.docx, Section 7) — Graph creates
// the calendar event and sends each attendee a standard Outlook/Teams invite itself, so
// nothing needs to be hand-built for the email. Reuses server/mailer.js's app-only token
// (client-credentials against the same Azure App Registration). Requires that
// registration to also be granted the Calendars.ReadWrite application permission,
// admin-consented and scoped to MS_GRAPH_SENDER via the same Exchange Application Access
// Policy already used for Mail.Send — no new environment variables needed.
const mailer = require('./mailer');

const SENDER = process.env.MS_GRAPH_SENDER;

// { subject, startIso, endIso, attendeeEmails, agendaHtml } -> { eventId, joinUrl }
async function createTeamsMeeting({ subject, startIso, endIso, attendeeEmails, agendaHtml }) {
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
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      body: { contentType: 'HTML', content: agendaHtml },
      attendees: attendeeEmails.map((email) => ({ emailAddress: { address: email }, type: 'required' })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph create event failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return { eventId: data.id, joinUrl: (data.onlineMeeting && data.onlineMeeting.joinUrl) || null };
}

module.exports = { createTeamsMeeting };
