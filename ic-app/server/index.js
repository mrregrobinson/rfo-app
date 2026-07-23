require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const db = require('./db');
const { hashSecret, verifySecret, encryptSecret, decryptSecret, requireAuth } = require('./auth');
const totp = require('./totp');
const { ensureSeeded, issueSetupCode } = require('./seed');
const claude = require('./claude');
const { logAudit, auditRowToJson } = require('./audit');
const { logApiUsage, usageSummary } = require('./usage');
const { runBackup, listBackups, scheduleBackups, BACKUPS_DIR } = require('./backup');
const mailer = require('./mailer');
const registerTaskRoutes = require('./tasks');
const { startDigestScheduler } = require('./digest');
const registerMeetingRoutes = require('./meetings');
const { startMeetingsScheduler } = require('./meetings-scheduler');

ensureSeeded();
scheduleBackups();

// One-time import of the family's Family_Office_Task_List_2026 Q2.xlsx tracker — safe to
// run on every boot since import-tasks.js no-ops once the tasks table is non-empty.
// Invoked here (rather than staying purely a manual "node server/import-tasks.js" step)
// because this deployment has no interactive shell access to run it after the fact.
try {
  require('./import-tasks');
} catch (err) {
  console.error('Task list import failed:', err.message);
}

const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const app = express();

// Railway sits in front of this app as a reverse proxy and sets X-Forwarded-For, which
// express-rate-limit refuses to trust by default (it can't tell a real client IP from a
// spoofed header otherwise). `1` trusts exactly one hop — the platform's own proxy —
// which is correct here since we're not behind any additional untrusted proxy layer.
app.set('trust proxy', 1);

// This app ships as a handful of single-file HTML pages with an inline <script>/<style>
// and loads React from unpkg.com, so the CSP below allows those specifically rather
// than using helmet's stricter defaults (which would break the app outright).
// accounts.google.com / tasks.googleapis.com are for the Task List's "Add to Google
// Tasks" button (Google Identity Services token flow, called directly from the
// browser — see public/tasks.html).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://accounts.google.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://accounts.google.com', 'https://tasks.googleapis.com'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameSrc: ['https://accounts.google.com'],
        frameAncestors: ["'none'"],
      },
    },
    // Helmet's default Cross-Origin-Opener-Policy ("same-origin") severs window.opener
    // between this page and any popup it opens to another origin — which silently
    // breaks the Google Identity Services sign-in popup used by "Add to Google Tasks":
    // the user completes sign-in on Google's side, but the popup has no way to report
    // that back, so it just closes and GIS reports it as "popup_closed".
    // "same-origin-allow-popups" keeps the same protection but preserves that link for
    // popups the page itself opened.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

app.use(express.json({ limit: '60mb' }));
app.use(
  session({
    store: new FileStore({ path: SESSIONS_DIR, logFn: () => {} }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
    },
  })
);

// Coarse, IP-based net against scripted/automated attack traffic. The meaningful
// protection against a real guessing attempt is the per-account lockout below, since a
// shared IP-based limit alone would let one family member's typos lock out the house.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts from this network. Wait a few minutes and try again.' },
});

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function isLocked(row) {
  return !!row.locked_until && new Date(row.locked_until).getTime() > Date.now();
}

function lockMessage(row) {
  const mins = Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000));
  return `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

function registerFailure(userId) {
  const row = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(userId);
  const attempts = (row?.failed_attempts || 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString() : null;
  db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockedUntil, userId);
}

function clearFailures(userId) {
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
}

async function beginTotpSetup(userId) {
  const secret = totp.generateSecret();
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(encryptSecret(secret), userId);
  const row = db.prepare('SELECT name FROM users WHERE id = ?').get(userId);
  const otpauthUrl = totp.otpauthUrl({ secretBase32: secret, accountName: row.name });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
  return { secret, otpauthUrl, qrDataUrl };
}

// ---- helpers ----

// isAdmin here means Family Office Administrator (is_fo_admin) — kept under this name
// because the existing frontend chrome (Manage Members / Audit Log / Usage / Backups
// menu) is genuinely FO-level, not Due-Diligence-specific. ddAdmin/tasksAdmin are the
// two per-application axes (Section 4 of the build spec); an FO admin is always also
// an admin of both apps, since FO administration is a superset.
function userPublic(row) {
  const isFoAdmin = !!row.is_fo_admin;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    initials: row.initials,
    color: row.color,
    isAdmin: isFoAdmin,
    ddAdmin: isFoAdmin || row.dd_role === 'admin',
    ddRole: row.dd_role,
    tasksAdmin: isFoAdmin || row.tasks_role === 'admin',
    tasksRole: row.tasks_role,
    meetingsAdmin: isFoAdmin || row.meetings_role === 'admin',
    meetingsRole: row.meetings_role,
    needsSetup: !row.password_hash,
    isActive: !!row.is_active,
  };
}

// Includes email — never exposed via the public /api/members list (fetched
// unauthenticated by the Login screen), only via admin-only routes.
function userPublicAdmin(row) {
  return { ...userPublic(row), email: row.email || null };
}

// Per-app role helpers (Section 4 of the build spec). An FO admin is always also an
// admin of both apps; otherwise the relevant per-app role column decides.
function ddRoleOf(userId) {
  const row = db.prepare('SELECT is_fo_admin, dd_role FROM users WHERE id = ?').get(userId);
  if (!row) return { isAdmin: false, canReview: false };
  const isAdmin = !!row.is_fo_admin || row.dd_role === 'admin';
  return { isAdmin, canReview: isAdmin || row.dd_role === 'member' };
}

function responseRowToJson(row) {
  return {
    responses: JSON.parse(row.responses),
    recommendation: row.recommendation,
    overall: row.overall,
    followUp: JSON.parse(row.follow_up),
    submitted: !!row.submitted,
    sentAt: row.sent_at,
  };
}

function oppRowToJson(row) {
  const responseRows = db.prepare('SELECT * FROM responses WHERE opportunity_id = ?').all(row.id);
  const responses = {};
  for (const r of responseRows) responses[r.user_id] = responseRowToJson(r);
  return {
    id: row.id,
    title: row.title,
    assetClass: row.asset_class,
    commitment: row.commitment,
    currency: row.currency,
    deadline: row.deadline,
    additionalContext: row.additional_context,
    notifyLucas: !!row.notify_lucas,
    createdAt: row.created_at,
    initiatedBy: row.initiated_by,
    status: row.status,
    pqSummary: row.pq_summary,
    pqData: JSON.parse(row.pq_data),
    research: JSON.parse(row.research || '{}'),
    report: row.report ? JSON.parse(row.report) : null,
    decision: row.decision ? JSON.parse(row.decision) : null,
    responses,
  };
}

// ---- auth routes ----
//
// Two states a member can be in:
//   1. Unclaimed: password_hash is NULL. They hold a one-time setup code (from first
//      boot, or from an admin reset) and must call /api/auth/claim-account.
//   2. Claimed: password + TOTP 2FA set. Normal login is password (/api/login) then a
//      TOTP code (/api/login/verify-totp). If someone abandoned setup after the
//      password step but before confirming 2FA, /api/login detects that and tells the
//      frontend to resume via /api/auth/totp-setup-info instead of failing outright.

// Public, non-secret config the frontend needs before login — a Google OAuth Client ID
// is meant to be embedded in client-side JS (unlike a client secret), so there's nothing
// sensitive here. Powers the "Add to Google Tasks" button; the button hides itself when
// this isn't set, same pattern as the Claude/MS Graph "not configured" fallbacks.
app.get('/api/config', (req, res) => {
  res.json({ googleTasksClientId: process.env.GOOGLE_TASKS_CLIENT_ID || null });
});

app.get('/api/members', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows.map(userPublic));
});

app.post('/api/auth/claim-account', loginLimiter, async (req, res) => {
  const { userId, setupCode, newPassword } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return res.status(404).json({ error: 'Member not found' });
  if (!row.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });
  if (row.password_hash) return res.status(400).json({ error: 'This account is already set up — use the normal sign-in.' });
  if (!verifySecret(setupCode || '', row.setup_code_hash)) {
    return res.status(400).json({ error: 'Invalid setup code' });
  }
  if (!newPassword || newPassword.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashSecret(newPassword), userId);
  req.session.setupUserId = userId;
  try {
    res.json(await beginTotpSetup(userId));
  } catch {
    res.status(500).json({ error: 'Failed to generate 2FA setup' });
  }
});

// Resumes 2FA setup for someone who set a password but never confirmed their
// authenticator app (e.g. closed the tab mid-setup). Requires the password again since
// there's no active session at this point.
app.post('/api/auth/totp-setup-info', loginLimiter, async (req, res) => {
  const userId = req.session.setupUserId;
  if (!userId) return res.status(401).json({ error: 'Sign in with your password first' });
  try {
    res.json(await beginTotpSetup(userId));
  } catch {
    res.status(500).json({ error: 'Failed to generate 2FA setup' });
  }
});

app.post('/api/auth/confirm-totp-setup', loginLimiter, (req, res) => {
  const userId = req.session.setupUserId;
  if (!userId) return res.status(401).json({ error: 'Start setup first' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row || !row.totp_secret) return res.status(400).json({ error: 'No pending 2FA setup' });
  if (isLocked(row)) return res.status(423).json({ error: lockMessage(row) });
  const secret = decryptSecret(row.totp_secret);
  if (!totp.verifyTotp(secret, req.body?.code)) {
    registerFailure(userId);
    return res.status(400).json({ error: 'Incorrect code — check your authenticator app and try again' });
  }
  clearFailures(userId);
  db.prepare('UPDATE users SET totp_enabled = 1, setup_code_hash = NULL WHERE id = ?').run(userId);
  delete req.session.setupUserId;
  req.session.userId = userId;
  logAudit({ userId, action: 'member.setup_completed', entityType: 'user', entityId: userId });
  res.json(userPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)));
});

app.post('/api/login', loginLimiter, (req, res) => {
  const { userId, password } = req.body || {};
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) return res.status(400).json({ error: 'Invalid member or password' });
  if (!row.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });
  if (!row.password_hash) return res.status(400).json({ error: 'NEEDS_SETUP', message: 'This account has not been set up yet — use your one-time setup code.' });
  if (isLocked(row)) return res.status(423).json({ error: lockMessage(row) });
  if (!verifySecret(password || '', row.password_hash)) {
    registerFailure(userId);
    return res.status(400).json({ error: 'Invalid member or password' });
  }
  clearFailures(userId);
  if (!row.totp_enabled) {
    req.session.setupUserId = userId;
    return res.json({ needsTotpSetup: true });
  }
  req.session.pendingTotpUserId = userId;
  res.json({ needsTotp: true });
});

app.post('/api/login/verify-totp', loginLimiter, (req, res) => {
  const userId = req.session.pendingTotpUserId;
  if (!userId) return res.status(401).json({ error: 'Enter your password first' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row || !row.totp_enabled) return res.status(400).json({ error: 'Account not fully set up' });
  if (isLocked(row)) return res.status(423).json({ error: lockMessage(row) });
  const secret = decryptSecret(row.totp_secret);
  if (!totp.verifyTotp(secret, req.body?.code)) {
    registerFailure(userId);
    return res.status(400).json({ error: 'Incorrect code' });
  }
  clearFailures(userId);
  delete req.session.pendingTotpUserId;
  req.session.userId = userId;
  logAudit({ userId, action: 'login.success', entityType: 'user', entityId: userId });
  res.json(userPublic(row));
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!row) return res.status(401).json({ error: 'Not authenticated' });
  res.json(userPublic(row));
});

// Admin-only member listing that includes email — the public /api/members list above
// deliberately omits it since that route is fetched unauthenticated by the Login screen.
app.get('/api/admin/members', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const rows = db.prepare('SELECT * FROM users').all();
  res.json(rows.map(userPublicAdmin));
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.put('/api/admin/members/:userId/email', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const email = (req.body?.email || '').trim();
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That doesn\'t look like a valid email address.' });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, req.params.userId);
  logAudit({ userId: req.session.userId, action: 'admin.member_email_updated', entityType: 'user', entityId: req.params.userId });
  res.json(userPublicAdmin(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId)));
});

// Admin-only recovery for a lost password/phone: issues a fresh one-time setup code,
// wiping the old password/2FA. Shown once in the response — relay it to the person
// directly (it plays the same role the original passcode did).
app.post('/api/admin/reset-auth/:userId', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  const setupCode = issueSetupCode(req.params.userId);
  logAudit({ userId: req.session.userId, action: 'admin.reset_auth', entityType: 'user', entityId: req.params.userId });
  res.json({ setupCode });
});

// Admin-only admin-status changes. Blocks demoting the last remaining admin so the
// family can never end up with no one able to reset a lost password or manage roles.
// Toggles Family Office Administrator status (member management, password/2FA resets —
// Section 4.1). Blocks demoting the last remaining FO admin so the family can never end
// up with no one able to reset a lost password or add/remove members.
app.put('/api/admin/members/:userId/admin', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const { isAdmin } = req.body || {};
  if (typeof isAdmin !== 'boolean') return res.status(400).json({ error: 'isAdmin (boolean) is required' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (!isAdmin && target.is_fo_admin) {
    const adminCount = db.prepare('SELECT COUNT(*) n FROM users WHERE is_fo_admin = 1').get().n;
    if (adminCount <= 1) return res.status(400).json({ error: 'Cannot remove the last remaining Family Office admin.' });
  }
  db.prepare('UPDATE users SET is_fo_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, req.params.userId);
  logAudit({ userId: req.session.userId, action: isAdmin ? 'admin.role_granted' : 'admin.role_revoked', entityType: 'user', entityId: req.params.userId });
  res.json(userPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId)));
});

// Sets a member's per-application role (Section 4.2) — independent of FO admin status.
// App-level roles are administered within each app, by that app's own admins — not
// exclusively by Family Office admins (an FO admin can still always do this, since FO
// admin is a superset of both). See the "top level vs. app level" reorganization: this
// route is called from due-diligence.html (app='dd') and tasks.html (app='tasks').
app.put('/api/admin/members/:userId/app-role', requireAuth, (req, res) => {
  const { app: appName, role } = req.body || {};
  if (!['dd', 'tasks', 'meetings'].includes(appName)) return res.status(400).json({ error: 'app must be "dd", "tasks", or "meetings"' });
  if (!['admin', 'member', 'viewer'].includes(role)) return res.status(400).json({ error: 'role must be admin, member, or viewer' });
  const me = db.prepare('SELECT is_fo_admin, dd_role, tasks_role, meetings_role FROM users WHERE id = ?').get(req.session.userId);
  const column = appName === 'dd' ? 'dd_role' : appName === 'tasks' ? 'tasks_role' : 'meetings_role';
  const isAppAdmin = !!me && (me.is_fo_admin || me[column] === 'admin');
  const appLabel = appName === 'dd' ? 'Due Diligence' : appName === 'tasks' ? 'Task List' : 'Meetings';
  if (!isAppAdmin) return res.status(403).json({ error: `${appLabel} admin only` });
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).run(role, req.params.userId);
  logAudit({ userId: req.session.userId, action: 'admin.app_role_updated', entityType: 'user', entityId: req.params.userId, details: { app: appName, role } });
  res.json(userPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId)));
});

const MEMBER_COLORS = ['#1B2A4A', '#2A7D7B', '#C9A84C', '#7C3AED', '#B45309', '#0E7490', '#9D174D', '#166534'];

function initialsFromName(name) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

// FO-admin-only: adds a new family member. Defaults to Optional/member/member — an
// FO admin grants FO-admin or app-admin rights afterward via the routes above, rather
// than a brand-new account starting with elevated access. Returns a one-time setup
// code, same as the reset-auth flow — shown once, relayed to the new member directly.
app.post('/api/admin/members', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const name = (req.body?.name || '').trim();
  const email = (req.body?.email || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That doesn\'t look like a valid email address.' });
  const id = crypto.randomUUID();
  const existingCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const color = MEMBER_COLORS[existingCount % MEMBER_COLORS.length];
  db.prepare('INSERT INTO users (id, name, role, initials, color, email) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, name, 'Optional', initialsFromName(name), color, email || null
  );
  const setupCode = issueSetupCode(id);
  logAudit({ userId: req.session.userId, action: 'admin.member_added', entityType: 'user', entityId: id, details: { name } });
  res.status(201).json({ ...userPublicAdmin(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), setupCode });
});

// FO-admin-only: deactivate/reactivate, in place of a hard delete — see migration 016.
// A deactivated member can't log in, but their name stays attached to past opportunity
// reviews, tasks, and audit log entries. Blocks deactivating the last remaining FO
// admin, or your own account (avoids an accidental self-lockout).
app.put('/api/admin/members/:userId/active', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive (boolean) is required' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (!isActive) {
    if (req.params.userId === req.session.userId) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    if (target.is_fo_admin) {
      const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_fo_admin = 1 AND is_active = 1').get().n;
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot deactivate the last remaining Family Office admin.' });
    }
  }
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, req.params.userId);
  logAudit({ userId: req.session.userId, action: isActive ? 'admin.member_reactivated' : 'admin.member_deactivated', entityType: 'user', entityId: req.params.userId });
  res.json(userPublicAdmin(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId)));
});

// Admin-only Required/Optional changes. Blocks dropping the Required headcount below the
// current quorum threshold — that would make quorum permanently unreachable, so the
// admin has to lower the threshold first (mirrors the last-admin protection above).
// Required/Optional is a Due Diligence quorum concept, so it's administered by DD
// admins (a superset includes FO admins), not exclusively Family Office admins.
app.put('/api/admin/members/:userId/role', requireAuth, (req, res) => {
  if (!ddRoleOf(req.session.userId).isAdmin) return res.status(403).json({ error: 'Due Diligence admin only' });
  const { role } = req.body || {};
  if (!['Required', 'Optional'].includes(role)) return res.status(400).json({ error: 'role must be "Required" or "Optional"' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (role === 'Optional' && target.role === 'Required') {
    const newRequiredCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Required'").get().n - 1;
    const threshold = Number(getSetting('quorum_threshold', '1'));
    if (newRequiredCount < threshold) {
      return res.status(400).json({ error: `Cannot make this member Optional — it would drop Required members below the quorum threshold (${threshold}). Lower the quorum threshold first.` });
    }
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.userId);
  logAudit({ userId: req.session.userId, action: 'admin.member_role_updated', entityType: 'user', entityId: req.params.userId, details: { role } });
  res.json(userPublic(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId)));
});

// ---- settings (quorum) ----

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

app.get('/api/settings', requireAuth, (req, res) => {
  res.json({ quorumThreshold: Number(getSetting('quorum_threshold', '1')) });
});

// Quorum threshold = how many Required-member submissions count as quorum for
// decision-making. Must stay within [1, current Required headcount] — a threshold above
// the number of people who could possibly submit would make quorum unreachable.
app.put('/api/admin/settings/quorum', requireAuth, (req, res) => {
  if (!ddRoleOf(req.session.userId).isAdmin) return res.status(403).json({ error: 'Due Diligence admin only' });
  const threshold = Number(req.body?.quorumThreshold);
  const requiredCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Required'").get().n;
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > requiredCount) {
    return res.status(400).json({ error: `quorumThreshold must be a whole number between 1 and ${requiredCount} (the current number of Required members).` });
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('quorum_threshold', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(threshold));
  logAudit({ userId: req.session.userId, action: 'admin.quorum_updated', entityType: 'setting', entityId: 'quorum_threshold', details: { threshold } });
  res.json({ quorumThreshold: threshold });
});

// ---- opportunity routes ----

// Drafts are only visible to whoever initiated them (or an admin) until published, and
// once published, each member only gains access once the initiator/admin has explicitly
// sent it to them (responses.sent_at) — that's the control point for "when it's sent to
// each member individually", replacing the old all-at-once-on-publish visibility.
function canSeeOpportunity(row, req) {
  if (row.initiated_by === req.session.userId) return true;
  if (ddRoleOf(req.session.userId).isAdmin) return true;
  if (row.status === 'draft') return false;
  const resp = db.prepare('SELECT sent_at FROM responses WHERE opportunity_id = ? AND user_id = ?').get(row.id, req.session.userId);
  return !!(resp && resp.sent_at);
}

app.get('/api/opportunities', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM opportunities ORDER BY created_at DESC').all();
  res.json(rows.filter((row) => canSeeOpportunity(row, req)).map(oppRowToJson));
});

app.get('/api/opportunities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || !canSeeOpportunity(row, req)) return res.status(404).json({ error: 'Not found' });
  res.json(oppRowToJson(row));
});

app.post('/api/opportunities', requireAuth, (req, res) => {
  if (!ddRoleOf(req.session.userId).canReview) return res.status(403).json({ error: 'Read-only members cannot initiate opportunities' });
  const b = req.body || {};
  if (!b.title || !b.assetClass) return res.status(400).json({ error: 'title and assetClass are required' });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO opportunities
      (id, title, asset_class, commitment, currency, deadline, additional_context, notify_lucas, created_at, initiated_by, status, pq_summary, pq_data, report, decision)
     VALUES (@id, @title, @assetClass, @commitment, @currency, @deadline, @additionalContext, @notifyLucas, @createdAt, @initiatedBy, 'draft', @pqSummary, @pqData, NULL, NULL)`
  ).run({
    id,
    title: b.title,
    assetClass: b.assetClass,
    commitment: Number(b.commitment) || 0,
    currency: b.currency || 'USD',
    deadline: b.deadline || null,
    additionalContext: b.additionalContext || '',
    notifyLucas: b.notifyLucas ? 1 : 0,
    createdAt: now,
    initiatedBy: req.session.userId,
    pqSummary: b.pqSummary || '',
    pqData: JSON.stringify(b.pqData || {}),
  });
  const members = db.prepare('SELECT id FROM users').all();
  for (const m of members) {
    db.prepare(
      `INSERT INTO responses (opportunity_id, user_id, responses, recommendation, overall, follow_up, submitted, updated_at)
       VALUES (?, ?, '{}', NULL, '', '[]', 0, ?)`
    ).run(id, m.id, now);
  }
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  logAudit({ userId: req.session.userId, action: 'opportunity.created', entityType: 'opportunity', entityId: id, details: { title: b.title } });
  res.status(201).json(oppRowToJson(row));
});

// Editing the opportunity's own description (title, terms, PQ data, etc.) is limited to
// the admin or whoever initiated it — distinct from editing your own review response,
// which any member can do for themselves.
app.put('/api/opportunities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Opportunity not found' });
  if (row.status === 'closed') return res.status(403).json({ error: 'This opportunity is closed and no longer accepts changes' });
  if (row.initiated_by !== req.session.userId && !ddRoleOf(req.session.userId).isAdmin) {
    return res.status(403).json({ error: 'Only the initiator or an admin can edit this opportunity' });
  }
  const b = req.body || {};
  if (!b.title || !b.assetClass) return res.status(400).json({ error: 'title and assetClass are required' });
  db.prepare(
    `UPDATE opportunities SET
       title=@title, asset_class=@assetClass, commitment=@commitment, currency=@currency,
       deadline=@deadline, additional_context=@additionalContext, notify_lucas=@notifyLucas,
       pq_summary=@pqSummary, pq_data=@pqData
     WHERE id=@id`
  ).run({
    id: req.params.id,
    title: b.title,
    assetClass: b.assetClass,
    commitment: Number(b.commitment) || 0,
    currency: b.currency || row.currency,
    deadline: b.deadline || null,
    additionalContext: b.additionalContext ?? row.additional_context,
    notifyLucas: b.notifyLucas ? 1 : 0,
    pqSummary: b.pqSummary ?? row.pq_summary,
    pqData: JSON.stringify(b.pqData || {}),
  });
  res.json(oppRowToJson(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id)));
});

// Admin-only, and irreversible — removes the opportunity and (via ON DELETE CASCADE)
// every member's response to it. Restricted beyond the initiator/admin edit rule above
// since this destroys data rather than just changing it.
app.delete('/api/opportunities/:id', requireAuth, (req, res) => {
  if (!ddRoleOf(req.session.userId).isAdmin) return res.status(403).json({ error: 'Due Diligence admin only' });
  const row = db.prepare('SELECT id, title FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Opportunity not found' });
  db.prepare('DELETE FROM opportunities WHERE id = ?').run(req.params.id);
  logAudit({ userId: req.session.userId, action: 'opportunity.deleted', entityType: 'opportunity', entityId: req.params.id, details: { title: row.title } });
  res.json({ ok: true });
});

app.put('/api/opportunities/:id/responses/:userId', requireAuth, (req, res) => {
  const { id, userId } = req.params;
  const myDdRole = ddRoleOf(req.session.userId);
  if (userId !== req.session.userId) {
    if (!myDdRole.isAdmin) return res.status(403).json({ error: 'Cannot edit another member\'s response' });
  } else if (!myDdRole.canReview) {
    return res.status(403).json({ error: 'Read-only members cannot submit a review response' });
  }
  const opp = db.prepare('SELECT id, title, status, initiated_by FROM opportunities WHERE id = ?').get(id);
  if (!opp || !canSeeOpportunity(opp, req)) return res.status(404).json({ error: 'Opportunity not found' });
  if (opp.status === 'closed') return res.status(403).json({ error: 'This opportunity is closed and no longer accepts changes' });
  const b = req.body || {};
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO responses (opportunity_id, user_id, responses, recommendation, overall, follow_up, submitted, updated_at)
     VALUES (@oid, @uid, @responses, @recommendation, @overall, @followUp, @submitted, @updatedAt)
     ON CONFLICT(opportunity_id, user_id) DO UPDATE SET
       responses = excluded.responses,
       recommendation = excluded.recommendation,
       overall = excluded.overall,
       follow_up = excluded.follow_up,
       submitted = excluded.submitted,
       updated_at = excluded.updated_at`
  ).run({
    oid: id,
    uid: userId,
    responses: JSON.stringify(b.responses || {}),
    recommendation: b.recommendation || null,
    overall: b.overall || '',
    followUp: JSON.stringify(b.followUp || []),
    submitted: b.submitted ? 1 : 0,
    updatedAt: now,
  });
  const row = db.prepare('SELECT * FROM responses WHERE opportunity_id = ? AND user_id = ?').get(id, userId);
  if (b.submitted) {
    logAudit({ userId: req.session.userId, action: 'response.submitted', entityType: 'opportunity', entityId: id, details: { forUserId: userId, recommendation: b.recommendation || null } });
    notifyAdminsOfSubmission(opp, userId, b.recommendation);
  }
  res.json(responseRowToJson(row));
});

// Fire-and-forget: admins get an email when someone submits, but the submitter's own
// request shouldn't wait on N Graph API round-trips (or fail if mail isn't configured).
function notifyAdminsOfSubmission(opp, submitterId, recommendation) {
  const submitter = db.prepare('SELECT name FROM users WHERE id = ?').get(submitterId);
  const admins = db.prepare("SELECT name, email FROM users WHERE (is_fo_admin = 1 OR dd_role = 'admin') AND id != ?").all(submitterId);
  for (const admin of admins) {
    if (!admin.email) continue;
    mailer.sendMail({
      to: admin.email,
      subject: `Review submitted: ${submitter.name} — ${opp.title}`,
      html: `<p>Hi ${admin.name.split(' ')[0]},</p>` +
        `<p><strong>${submitter.name}</strong> submitted their review for <strong>${opp.title}</strong>` +
        (recommendation ? ` — recommendation: <strong>${recommendation}</strong>.` : '.') +
        `</p><p><a href="${APP_BASE_URL}/due-diligence">Open PQ Introduced Due Diligence</a> to view the full report.</p>`,
    }).catch((err) => {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        console.error('Failed to send submission notification email:', err.message);
      }
    });
  }
}

// Deterministic governance rule, independent of Claude's own analytical report.recommendation:
// any decline is a veto, unanimous approval among those who've submitted is a clean pass,
// anything else (conditional approvals and/or abstentions mixed in) needs the IC to
// actually discuss it. Mirrors the client-side Decision section on the report page exactly.
function computeDecision(oppId) {
  const rows = db.prepare("SELECT recommendation FROM responses WHERE opportunity_id = ? AND submitted = 1 AND recommendation IS NOT NULL").all(oppId);
  if (rows.length === 0) return { label: 'Pending', detail: 'No IC member had submitted a recommendation.' };
  const recs = rows.map((r) => r.recommendation);
  if (recs.includes('Decline')) return { label: 'Declined', detail: 'At least one IC member recommended declining this opportunity.' };
  if (recs.every((r) => r === 'Approve')) return { label: 'Approved', detail: `All ${rows.length} submitted review${rows.length === 1 ? '' : 's'} recommended approval.` };
  return { label: 'More IC Discussion Required', detail: 'Recommendations were mixed (conditional approval and/or abstention).' };
}

// Fire-and-forget: closing is the trigger for the final, whole-family notification — the
// admin's close action shouldn't wait on N Graph API round-trips. Reads whatever report is
// currently saved on the opportunity — the frontend generates a fresh one immediately
// before calling this endpoint, so it reflects the final state at closing time.
function notifyFamilyOfClosure(row) {
  const decision = computeDecision(row.id);
  const report = row.report ? JSON.parse(row.report) : null;
  const members = db.prepare('SELECT name, email FROM users WHERE is_active = 1').all();
  for (const member of members) {
    if (!member.email) continue;
    const recLine = report?.recommendation ? `<p>Claude's analytical recommendation: <strong>${report.recommendation}</strong></p>` : '';
    const summaryLine = report?.executiveSummary ? `<p>${report.executiveSummary}</p>` : '';
    mailer.sendMail({
      to: member.email,
      subject: `IC Decision: ${row.title} — ${decision.label}`,
      html: `<p>Hi ${member.name.split(' ')[0]},</p>` +
        `<p>The IC review for <strong>${row.title}</strong> has been closed.</p>` +
        `<p style="font-size:16px"><strong>Decision: ${decision.label}</strong></p>` +
        `<p>${decision.detail}</p>` +
        recLine + summaryLine +
        `<p><a href="${APP_BASE_URL}/due-diligence">Open PQ Introduced Due Diligence</a> to view the full report.</p>`,
    }).catch((err) => {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        console.error('Failed to send closure notification email:', err.message);
      }
    });
  }
}

// Closing an opportunity is the only thing that locks responses — submitting your own
// review just records your recommendation, it does not stop you from revising it later.
// Publishing a draft is the one transition the initiator can make themselves, without
// needing admin rights — everything else (open <-> closed) stays admin-only. Publishing
// no longer grants the rest of the family visibility by itself — see the /send route
// below for the per-member step that actually does that.
app.put('/api/opportunities/:id/status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'status must be "open" or "closed"' });
  const row = db.prepare('SELECT id, status, initiated_by FROM opportunities WHERE id = ?').get(req.params.id);
  if (!row || !canSeeOpportunity(row, req)) return res.status(404).json({ error: 'Opportunity not found' });
  const isAdmin = ddRoleOf(req.session.userId).isAdmin;
  if (row.status === 'draft') {
    if (status !== 'open') return res.status(400).json({ error: 'A draft can only be published (set to "open")' });
    if (row.initiated_by !== req.session.userId && !isAdmin) {
      return res.status(403).json({ error: 'Only the initiator or an admin can publish this opportunity' });
    }
  } else if (!isAdmin) {
    return res.status(403).json({ error: 'Only an admin can close or reopen an opportunity' });
  }
  db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(status, req.params.id);
  const action = row.status === 'draft' ? 'opportunity.published' : status === 'closed' ? 'opportunity.closed' : 'opportunity.reopened';
  logAudit({ userId: req.session.userId, action, entityType: 'opportunity', entityId: req.params.id });
  if (status === 'closed' && row.status !== 'closed') {
    const fresh = db.prepare('SELECT id, title, report FROM opportunities WHERE id = ?').get(req.params.id);
    notifyFamilyOfClosure(fresh);
  }
  res.json({ status });
});

// Grants one specific member access to an already-published opportunity — the initiator
// (or an admin) calls this individually, on their own schedule, instead of publishing
// blasting visibility to the whole family at once.
app.post('/api/opportunities/:id/send/:userId', requireAuth, async (req, res) => {
  const { id, userId } = req.params;
  const row = db.prepare('SELECT id, title, status, initiated_by FROM opportunities WHERE id = ?').get(id);
  if (!row || !canSeeOpportunity(row, req)) return res.status(404).json({ error: 'Opportunity not found' });
  const isAdmin = ddRoleOf(req.session.userId).isAdmin;
  if (row.initiated_by !== req.session.userId && !isAdmin) {
    return res.status(403).json({ error: 'Only the initiator or an admin can send this opportunity' });
  }
  if (row.status === 'draft') return res.status(400).json({ error: 'Publish this opportunity before sending it to members' });
  const target = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  const now = new Date().toISOString();
  // UPSERT rather than plain UPDATE — a member added after this opportunity was created
  // has no responses row yet, and a bare UPDATE would silently affect zero rows.
  db.prepare(
    `INSERT INTO responses (opportunity_id, user_id, responses, recommendation, overall, follow_up, submitted, updated_at, sent_at)
     VALUES (?, ?, '{}', NULL, '', '[]', 0, ?, ?)
     ON CONFLICT(opportunity_id, user_id) DO UPDATE SET sent_at = excluded.sent_at`
  ).run(id, userId, now, now);
  logAudit({ userId: req.session.userId, action: 'opportunity.sent_to_member', entityType: 'opportunity', entityId: id, details: { toUserId: userId } });

  let emailSent = false;
  let emailError = null;
  if (target.email) {
    try {
      await mailer.sendMail({
        to: target.email,
        subject: `New opportunity to review: ${row.title}`,
        html: `<p>Hi ${target.name.split(' ')[0]},</p>` +
          `<p>A PQ Introduced Due Diligence opportunity has been shared with you for review: <strong>${row.title}</strong>.</p>` +
          `<p><a href="${APP_BASE_URL}/due-diligence">Open PQ Introduced Due Diligence</a> to review it.</p>`,
      });
      emailSent = true;
    } catch (err) {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        emailError = err.message;
        console.error('Failed to send opportunity notification email:', err.message);
      }
    }
  }
  res.json({ userId, sentAt: now, emailSent, emailError });
});

// ---- family planning activities ----
// Shared across every opportunity (not tied to one review) since these compete for the
// same pool of cash as any IC commitment — every reviewer should see the same list.

function activityRowToJson(row) {
  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    decreaseClass: row.decrease_class,
    increaseClass: row.increase_class,
    impact: row.impact,
    status: row.status,
    timing: row.timing,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get('/api/activities', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM activities ORDER BY created_at DESC').all();
  res.json(rows.map(activityRowToJson));
});

app.post('/api/activities', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.description) return res.status(400).json({ error: 'description is required' });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO activities (id, description, amount, currency, decrease_class, increase_class, impact, status, timing, created_by, created_at, updated_at)
     VALUES (@id, @description, @amount, @currency, @decreaseClass, @increaseClass, @impact, @status, @timing, @createdBy, @createdAt, @updatedAt)`
  ).run({
    id,
    description: b.description,
    amount: Number(b.amount) || 0,
    currency: b.currency || 'CAD',
    decreaseClass: b.decreaseClass || null,
    increaseClass: b.increaseClass || null,
    impact: b.impact || '',
    status: b.status || 'Considering',
    timing: b.timing || 'Uncertain',
    createdBy: req.session.userId,
    createdAt: now,
    updatedAt: now,
  });
  logAudit({ userId: req.session.userId, action: 'activity.created', entityType: 'activity', entityId: id, details: { description: b.description } });
  res.status(201).json(activityRowToJson(db.prepare('SELECT * FROM activities WHERE id = ?').get(id)));
});

app.put('/api/activities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activity not found' });
  const b = req.body || {};
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE activities SET description=@description, amount=@amount, currency=@currency, decrease_class=@decreaseClass, increase_class=@increaseClass, impact=@impact, status=@status, timing=@timing, updated_at=@updatedAt WHERE id=@id`
  ).run({
    id: req.params.id,
    description: b.description ?? row.description,
    amount: b.amount != null ? Number(b.amount) : row.amount,
    currency: b.currency || row.currency,
    decreaseClass: b.decreaseClass !== undefined ? (b.decreaseClass || null) : row.decrease_class,
    increaseClass: b.increaseClass !== undefined ? (b.increaseClass || null) : row.increase_class,
    impact: b.impact ?? row.impact,
    status: b.status || row.status,
    timing: b.timing || row.timing,
    updatedAt: now,
  });
  logAudit({ userId: req.session.userId, action: 'activity.updated', entityType: 'activity', entityId: req.params.id });
  res.json(activityRowToJson(db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id)));
});

app.delete('/api/activities/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM activities WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Activity not found' });
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  logAudit({ userId: req.session.userId, action: 'activity.deleted', entityType: 'activity', entityId: req.params.id });
  res.json({ ok: true });
});

// ---- Claude proxy routes ----

const RESEARCH_TYPES = ['manager', 'industry', 'regulatory'];

// Research is expensive (web search + thinking) and identical for every reviewer looking
// at the same opportunity, so it's fetched once and cached on the opportunity row. Any
// member opening the checklist afterwards gets the cached result instantly, at no extra
// API cost. Pass ?refresh=true to force a fresh lookup (e.g. weeks later, on request).
app.post('/api/opportunities/:id/research/:type', requireAuth, async (req, res) => {
  const { id, type } = req.params;
  if (!RESEARCH_TYPES.includes(type)) return res.status(400).json({ error: 'Unknown research type' });
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Opportunity not found' });

  const research = JSON.parse(row.research || '{}');
  const forceRefresh = req.query.refresh === 'true' || req.body?.refresh === true;
  if (research[type] && !forceRefresh) {
    return res.json(research[type]);
  }

  try {
    const { result, usage } = await claude.research(type, oppRowToJson(row));
    research[type] = result;
    db.prepare('UPDATE opportunities SET research = ? WHERE id = ?').run(JSON.stringify(research), id);
    logApiUsage({ callType: `research:${type}`, usage, opportunityId: id, userId: req.session.userId });
    res.json(result);
  } catch (err) {
    if (err instanceof claude.ClaudeNotConfiguredError) {
      return res.status(503).json({ error: 'NOT_CONFIGURED', message: err.message });
    }
    res.status(502).json({ error: err.message || 'Claude request failed' });
  }
});

// Unlike the original spec, this is never auto-triggered on quorum — any member can pull
// the current state of the review into a summary at any time, complete or not. The
// business logic for "what's an auto-answer vs. a human answer" lives in the frontend
// (computeClaudeAnswers), so the client sends the already-assembled context; this route is
// just the Claude call + persistence, mirroring the research proxy above.
app.post('/api/opportunities/:id/report', requireAuth, async (req, res) => {
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
  if (!row || !canSeeOpportunity(row, req)) return res.status(404).json({ error: 'Opportunity not found' });
  const { questions, autoAnswers, members, totalCAD } = req.body || {};
  if (!Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'members is required' });
  }
  try {
    const opp = oppRowToJson(row);
    const { result: generated, usage } = await claude.generateReport({
      opp: {
        title: opp.title,
        assetClass: opp.assetClass,
        commitment: opp.commitment,
        currency: opp.currency,
        pqSummary: opp.pqSummary,
      },
      questions: questions || [],
      autoAnswers: autoAnswers || {},
      members,
      totalCAD,
    });
    const report = {
      ...generated,
      generatedAt: new Date().toISOString(),
      generatedBy: req.session.userId,
      submittedCount: members.filter((m) => m.submitted).length,
      memberCount: members.length,
    };
    db.prepare('UPDATE opportunities SET report = ? WHERE id = ?').run(JSON.stringify(report), id);
    logApiUsage({ callType: 'report', usage, opportunityId: id, userId: req.session.userId });
    logAudit({ userId: req.session.userId, action: 'report.generated', entityType: 'opportunity', entityId: id, details: { recommendation: generated.recommendation } });
    res.json(report);
  } catch (err) {
    if (err instanceof claude.ClaudeNotConfiguredError) {
      return res.status(503).json({ error: 'NOT_CONFIGURED', message: err.message });
    }
    res.status(502).json({ error: err.message || 'Claude request failed' });
  }
});

app.post('/api/claude/extract-pdf', requireAuth, async (req, res) => {
  try {
    const { base64 } = req.body || {};
    if (!base64) return res.status(400).json({ error: 'base64 is required' });
    const { result, usage } = await claude.extractPdf(base64);
    logApiUsage({ callType: 'extract_pdf', usage, userId: req.session.userId });
    res.json(result);
  } catch (err) {
    if (err instanceof claude.ClaudeNotConfiguredError) {
      return res.status(503).json({ error: 'NOT_CONFIGURED', message: err.message });
    }
    res.status(502).json({ error: err.message || 'Claude request failed' });
  }
});

app.get('/api/admin/backups', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  res.json(listBackups());
});

app.post('/api/admin/backups', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  try {
    const filename = runBackup();
    logAudit({ userId: req.session.userId, action: 'backup.created', entityType: 'backup', entityId: filename });
    res.json({ filename });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Backup failed' });
  }
});

// Only serves filenames that appear in the current backups listing — never trusts the raw
// URL param directly for a filesystem path (path traversal).
app.get('/api/admin/backups/:filename', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const match = listBackups().find((b) => b.filename === req.params.filename);
  if (!match) return res.status(404).json({ error: 'Backup not found' });
  res.download(path.join(BACKUPS_DIR, match.filename));
});

app.get('/api/admin/usage', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  res.json(usageSummary());
});

app.get('/api/admin/audit-log', requireAuth, (req, res) => {
  const me = db.prepare('SELECT is_fo_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!me || !me.is_fo_admin) return res.status(403).json({ error: 'Family Office admin only' });
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  res.json(rows.map(auditRowToJson));
});

// ---- task list routes + digest scheduler ----

registerTaskRoutes(app, { db, logAudit });
startDigestScheduler(db);

// ---- meetings routes + invite scheduler ----

registerMeetingRoutes(app, { db, logAudit });
startMeetingsScheduler(db);

// ---- static frontend ----
//
// Umbrella shell (Section 3.2): "/" is the RFO home page (links to both apps), with the
// Due Diligence app moved to "/due-diligence" and the Task List at "/tasks". `index:
// false` stops express.static from auto-serving public/index.html at "/" the way it did
// before this app had more than one page.

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'home.html')));
app.get('/due-diligence', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'due-diligence.html')));
app.get('/tasks', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tasks.html')));
app.get('/meetings', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'meetings.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RFO server listening on http://localhost:${PORT}`);
});
