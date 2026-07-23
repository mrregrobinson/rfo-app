// Scheduled Task List email digest — Section 7 of the build spec. No cron dependency,
// consistent with the rest of this codebase (node:sqlite, node:crypto, etc. over
// third-party equivalents): a single hourly setInterval compares the current time
// (in the configured timezone) against the admin-configured cadence.
const mailer = require('./mailer');

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';

function currentQuarter(date = new Date()) {
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${q}`;
}

function quarterKey(q) {
  const [y, qq] = q.split('-Q').map(Number);
  return y * 4 + (qq - 1);
}

// Buckets one member's open tasks per Section 7.3: high priority (current-or-overdue)
// first, then medium, then low, then everything due in a future quarter (itself
// sub-ordered by priority — see the "Decided" note in Section 7.3), then unscheduled.
function bucketTasks(tasks) {
  const nowQ = quarterKey(currentQuarter());
  const currentOrOverdue = [];
  const future = [];
  const unscheduled = [];
  for (const t of tasks) {
    if (!t.targetQuarter) unscheduled.push(t);
    else if (quarterKey(t.targetQuarter) <= nowQ) currentOrOverdue.push(t);
    else future.push(t);
  }
  const byPriority = (list, p) => list.filter((t) => t.priority === p).sort((a, b) => (a.targetQuarter || '').localeCompare(b.targetQuarter || ''));
  return {
    high: byPriority(currentOrOverdue, 'high'),
    medium: byPriority(currentOrOverdue, 'medium'),
    low: byPriority(currentOrOverdue, 'low'),
    future: [...future].sort((a, b) => (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]) || (a.targetQuarter || '').localeCompare(b.targetQuarter || '')),
    unscheduled,
  };
}

// Scoped to exactly this member: tasks assigned to them individually, plus tasks
// assigned to "All" (a NULL task_assignees.user_id row) — never another member's
// individually-assigned tasks. assignedToAll is carried through so the email can label
// which items are shared rather than personal (Section: digest clarity).
function tasksForUser(db, userId) {
  const rows = db
    .prepare(
      `SELECT t.*, MAX(CASE WHEN ta.user_id IS NULL THEN 1 ELSE 0 END) AS assigned_to_all
       FROM tasks t
       JOIN task_assignees ta ON ta.task_id = t.id
       WHERE t.status = 'open' AND (ta.user_id = ? OR ta.user_id IS NULL)
       GROUP BY t.id
       ORDER BY t.created_at`
    )
    .all(userId);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    priority: row.priority,
    targetQuarter: row.target_quarter,
    assignedToAll: !!row.assigned_to_all,
  }));
}

function sectionHtml(label, tasks) {
  if (tasks.length === 0) return '';
  const items = tasks
    .map((t) => {
      const quarter = t.targetQuarter ? ` — ${t.targetQuarter}` : '';
      const allTag = t.assignedToAll ? ' <span style="color:#854F0B;">(shared with all)</span>' : '';
      return `<li><a href="${APP_BASE_URL}/tasks?task=${t.id}">${t.title}</a>${quarter}${allTag}</li>`;
    })
    .join('');
  return `<h3 style="margin:16px 0 6px;font-size:13px;color:#1B2A4A;">${label}</h3><ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

function buildDigestHtml(member, buckets) {
  const sections = [
    sectionHtml('High priority — due this quarter or overdue', buckets.high),
    sectionHtml('Medium priority — due this quarter or overdue', buckets.medium),
    sectionHtml('Low priority — due this quarter or overdue', buckets.low),
    sectionHtml('Future quarters', buckets.future),
    sectionHtml('Unscheduled', buckets.unscheduled),
  ].join('');
  return `<p>Hi ${member.name.split(' ')[0]},</p><p>Here's where things stand on your Family Task List items — tasks assigned to you, plus anything shared with everyone:</p>${sections}<p style="margin-top:16px;"><a href="${APP_BASE_URL}/tasks">Open the Family Task List</a></p>`;
}

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row && row.value !== '' ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

function nowPartsInTimezone(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: 'numeric',
    weekday: 'short',
    day: 'numeric',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(get('hour')) % 24,
    weekday: weekdayMap[get('weekday')],
    day: Number(get('day')),
    dateStr: `${get('year')}-${String(get('month')).padStart(2, '0')}-${String(get('day')).padStart(2, '0')}`,
  };
}

function isDue(db) {
  if (getSetting(db, 'task_digest_enabled', '0') !== '1') return false;
  const cadence = getSetting(db, 'task_digest_cadence', 'weekly');
  const dayOfWeek = Number(getSetting(db, 'task_digest_day_of_week', '1'));
  const dayOfMonth = Number(getSetting(db, 'task_digest_day_of_month', '1'));
  const hourLocal = Number(getSetting(db, 'task_digest_hour_local', '8'));
  const timezone = getSetting(db, 'task_digest_timezone', 'America/Toronto');
  const lastSentAt = getSetting(db, 'task_digest_last_sent_at', '');

  const parts = nowPartsInTimezone(timezone);
  if (parts.hour !== hourLocal) return false;
  if (lastSentAt.slice(0, 10) === parts.dateStr) return false; // already sent today — avoid double-send within the send hour

  if (cadence === 'daily') return true;
  if (cadence === 'weekly') return parts.weekday === dayOfWeek;
  if (cadence === 'biweekly') {
    if (parts.weekday !== dayOfWeek) return false;
    if (!lastSentAt) return true;
    const daysSince = (new Date(parts.dateStr) - new Date(lastSentAt.slice(0, 10))) / 86400000;
    return daysSince >= 13;
  }
  if (cadence === 'monthly') return parts.day === dayOfMonth;
  return false;
}

// Sends one member's digest regardless of whether they currently have any tasks —
// used both by the recurring sweep (which skips empty digests, see sendDigests) and by
// the admin "send me a test email" button (Section: digest test-send), where an empty
// result ("you're all caught up") is itself useful confirmation that mail is wired up.
async function sendDigestToUser(db, userId, { skipIfEmpty } = {}) {
  const member = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(userId);
  if (!member) throw new Error('Member not found');
  if (!member.email) throw new Error(`${member.name} has no email address on file — set one from Manage Members first.`);
  const buckets = bucketTasks(tasksForUser(db, member.id));
  const hasAnyTasks = Object.values(buckets).some((list) => list.length > 0);
  if (skipIfEmpty && !hasAnyTasks) return { sent: false, empty: true };
  await mailer.sendMail({
    to: member.email,
    subject: 'Your Family Task List update',
    html: buildDigestHtml(member, buckets),
  });
  return { sent: true, empty: !hasAnyTasks };
}

async function sendDigests(db) {
  const members = db.prepare('SELECT id FROM users').all();
  for (const member of members) {
    try {
      await sendDigestToUser(db, member.id, { skipIfEmpty: true });
    } catch (err) {
      if (!(err instanceof mailer.MailNotConfiguredError)) {
        console.error(`Failed to send task digest to ${member.id}:`, err.message);
      }
    }
  }
}

function startDigestScheduler(db) {
  async function check() {
    try {
      if (isDue(db)) {
        await sendDigests(db);
        setSetting(db, 'task_digest_last_sent_at', new Date().toISOString());
      }
    } catch (err) {
      console.error('Task digest scheduler error:', err.message);
    }
  }
  check();
  setInterval(check, 60 * 60 * 1000);
}

module.exports = { startDigestScheduler, bucketTasks, tasksForUser, buildDigestHtml, isDue, sendDigestToUser };
