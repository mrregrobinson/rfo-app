// Builds a standards-compliant iCalendar (RFC 5545) meeting request, sent as a .ics
// attachment via mailer.sendMail instead of created through the Graph Calendar API.
//
// Why: creating a calendar event via Microsoft Graph *application* (app-only, no
// signed-in user) permissions against a *shared* mailbox is a known gap — the event
// gets created and something gets emailed, but Outlook never fully treats it as a real
// trackable meeting (no Accept/Decline, never lands on the recipient's calendar).
// Confirmed directly against a real test invite: the message class was tagged as a
// meeting request, but Outlook's typed meeting properties (Start/End/Organizer/
// RequiredAttendees) were empty even though the raw MAPI start-date property had a
// value — a hallmark of missing Global-Object-ID-style tracking metadata that Graph's
// app-only + shared-mailbox path doesn't fully construct.
//
// A hand-built METHOD:REQUEST .ics attached to a normal email sidesteps that entirely:
// any calendar-aware client recognizes a well-formed .ics regardless of how the email
// itself was sent, since it isn't going through Graph's Calendar/Events endpoints at all.

function foldLine(line) {
  // RFC 5545 §3.1: content lines SHOULD be folded at 75 octets, continuation lines
  // start with a single space. Keeps strict calendar parsers happy on long
  // SUMMARY/DESCRIPTION/ATTENDEE lines.
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function escapeIcsText(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function toIcsDateUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// { uid, sequence, method, organizerEmail, organizerName, attendees: [{name,email}],
//   title, startDate, endDate, descriptionText } -> .ics file content (CRLF line endings)
function buildMeetingIcs({ uid, sequence, method, organizerEmail, organizerName, attendees, title, startDate, endDate, descriptionText }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Robinson Family Office//RFO Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${toIcsDateUtc(new Date())}`,
    `DTSTART:${toIcsDateUtc(startDate)}`,
    `DTEND:${toIcsDateUtc(endDate)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(descriptionText)}`,
    `ORGANIZER;CN=${escapeIcsText(organizerName)}:mailto:${organizerEmail}`,
    ...attendees.map((a) => `ATTENDEE;CN=${escapeIcsText(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildMeetingIcs };
