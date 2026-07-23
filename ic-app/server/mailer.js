// Sends transactional email via Microsoft Graph (client-credentials / app-only auth)
// rather than SMTP, since Microsoft has been retiring basic SMTP AUTH tenant-wide. Uses
// the family's existing Microsoft 365 tenant instead of adding a third-party mail vendor.
// Requires an Azure App Registration with an application-level Mail.Send permission,
// scoped (via an Exchange Application Access Policy) to the sending mailbox only.
// The Meetings module's Teams invites (server/graph-calendar.js) reuse this same
// registration's token and additionally need the Calendars.ReadWrite application
// permission granted on it, scoped the same way — no separate app registration or
// environment variables needed for that.

const TENANT_ID = process.env.MS_GRAPH_TENANT_ID;
const CLIENT_ID = process.env.MS_GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_GRAPH_CLIENT_SECRET;
const SENDER = process.env.MS_GRAPH_SENDER;

class MailNotConfiguredError extends Error {}

function isConfigured() {
  return !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET && SENDER);
}

let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (!isConfigured()) {
    throw new MailNotConfiguredError('Microsoft Graph mail is not configured (missing MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET / MS_GRAPH_SENDER).');
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to obtain Graph access token: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

// { to, subject, html } — sends as SENDER via Graph's /users/{sender}/sendMail.
// Throws MailNotConfiguredError if the MS_GRAPH_* env vars aren't set, or a plain Error
// on any Graph/HTTP failure — callers decide how much that should matter to the request
// that triggered the email (usually: log it, don't fail the request).
async function sendMail({ to, subject, html }) {
  const token = await getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

// Exported so server/graph-calendar.js (Meetings module Teams invites) can reuse the
// same app-only token rather than authenticating a second time — Graph's ".default"
// scope covers every permission granted on this app registration, Mail.Send and
// Calendars.ReadWrite alike, so one cached token serves both.
module.exports = { sendMail, isConfigured, getAccessToken, MailNotConfiguredError };
