# RFO — backend + app

This is the Robinson Family Office umbrella app: one server, one login, and three
applications under it —

- **PQ Introduced Due Diligence** (`/due-diligence`) — the IC checklist app for
  reviewing opportunities Prime Quadrant has introduced, formerly branded "IC Due
  Diligence." Same functionality as before, just renamed and moved under the umbrella
  shell.
- **Family Task List** (`/tasks`) — a shared, prioritized task tracker (Strategy /
  People / Core Business / Operations), seeded from the family's
  `Family_Office_Task_List_2026 Q2.xlsx`, with its own scheduled email digest.
- **Family Office Meetings** (`/meetings`) — schedule a meeting with an agenda and
  planned attendees, optionally emailing family attendees a calendar invite on a
  chosen date; record minutes against the agenda during the meeting (discussion summary,
  decisions, family/non-family action items); mark the meeting complete to email the
  finished minutes to every family attendee. A family action item recorded in the
  minutes creates a real task in the Family Task List. See
  `RFO_Meetings_App_BuildSpec_v1.docx` for the full build spec.

`/` is the RFO home page — sign in once, land there, and pick an app. All three apps
share the same accounts, sessions, and database (`data/ic.db`); there is no second
login.

## What changed vs. the old single-file HTML

- **Persistence**: opportunities and each member's responses are stored in a SQLite
  database (`data/ic.db`), not in browser memory. Refreshing the page, or having a
  different family member open the link, now shows the same shared state.
- **Login**: each member (Reg, Sheri-Dawn, Ross, Lucas) has their own passcode instead of
  a "pick your name from a dropdown" switcher. See "First run" below.
- **Claude features (web research + PDF auto-extraction)**: these used to call
  `api.anthropic.com` directly from the browser, which only works inside claude.ai. The
  server now proxies these calls using your own Anthropic API key. If you don't set one,
  the app still works — those specific fields just show "not configured" and you fill
  them in manually instead of Claude auto-filling them.

## Local setup

```
npm install
npm start
```

Then open http://localhost:3000.

### First run

The first time the server starts against an empty database, it generates a random
6-digit passcode for each of the 4 IC members and prints them **once** to the terminal:

```
=== First run: generated IC member passcodes (save these — shown only once) ===
  Reg Robinson             id=reg    passcode=123456
  ...
```

Copy these somewhere safe (e.g. a password manager) and send each person their own
passcode. They aren't recoverable from the database (only a salted hash is stored) — if
someone loses theirs, delete their row from the `users` table and restart the server to
regenerate it, or update the `passcode_hash` column directly using
`server/auth.js`'s `hashPasscode()`.

### Enabling live Claude research / PDF extraction

Copy `.env.example` to `.env` and set:

```
ANTHROPIC_API_KEY=sk-ant-...
```

This is billed pay-as-you-go on your Anthropic account (roughly a few cents per
opportunity reviewed — one PDF extraction call plus up to 3 web-research calls). Without
a key, the app runs fine; those fields just become manual entry.

Also set `SESSION_SECRET` to a long random string before deploying anywhere real —
the default in `.env.example` is only for local testing.

## Permissions

Two independent axes (see `RFO_Umbrella_TaskList_BuildSpec_v1.docx` in the parent folder
for the full rationale):

- **Family Office Administrator** (`users.is_fo_admin`) — family-office-wide: add/delete
  members, reset a lost password/2FA. Reg and Sheri-Dawn hold this today.
- **Per-application role** (`users.dd_role`, `users.tasks_role`, `users.meetings_role`,
  each `admin` / `member` / `viewer`) — independent per app. An FO admin is always also
  an admin of every app. Set from each app's own "Roles" panel, or directly via
  `PUT /api/admin/members/:userId/app-role` (`app` is `dd`, `tasks`, or `meetings`).

### One-off task import

The Task List's starting data comes from the family's existing
`Family_Office_Task_List_2026 Q2.xlsx` tracker, transcribed into
`server/task-import-data.js`. Run once, against an empty `tasks` table:

```
node server/import-tasks.js
```

Safe to re-run — it no-ops if the `tasks` table already has rows.

## Data model

- `users` — the 4 IC members, with a hashed passcode each, plus `is_fo_admin`,
  `dd_role`, `tasks_role`, and `meetings_role` (see Permissions above).
- `opportunities` — one row per fund/manager under review (title, asset class,
  commitment, the PQ data extracted from the research PDF, etc). Editable after
  creation via "Edit Details" on the checklist page — restricted to the opportunity's
  initiator or an admin, and blocked once the opportunity is closed.
- `responses` — one row per (opportunity, user) pair: their answers, recommendation,
  and submission status. This is what used to live only in React state.
- `activities` — forecasted family liquidity events (e.g. a planned withdrawal or an
  asset sale) that aren't tied to any one opportunity but compete for the same cash.
  Shown on every opportunity's checklist ("Family Planning Activities" panel) so
  reviewers can weigh known future capital needs alongside the commitment in front of
  them. Any signed-in member can add, edit, or remove entries.
  - Each activity names which asset class is **decreasing** (the source) and which is
    **increasing** (the destination) — either can be left as "External" to mean money
    leaving/entering the tracked portfolio entirely rather than moving between two
    classes. Both set = a reallocation (e.g. Real Assets → Cash on a property sale,
    total portfolio unchanged). One set, one External = money actually leaving or
    entering the family's tracked AUM (e.g. Cash → External for a withdrawal). Plus a
    **timing** bucket (0-6 / 6-12 / 12-24 / 24+ months / Uncertain).
  - Timing controls what feeds into the A4 liquidity check: only activities timed at
    0-6 months, 6-12 months, or Uncertain count against the 12-month cash-coverage
    calculation. All non-completed activities (regardless of timing) feed into the
    asset-allocation percentages shown in Section A, since allocation planning is
    forward-looking regardless of exact timing.
- `pillars` / `task_categories` — the Task List's fixed grouping (Strategy / People /
  Core Business / Operations, and their 12 subcategories), seeded by migration 013.
- `tasks` / `task_assignees` — one row per task (with optional `parent_task_id` for
  nested sub-items) and a join table for its assignee(s), where a `NULL` `user_id` means
  "assigned to All."
- `settings` — generic key/value store, also used for the Task List's digest cadence
  (`task_digest_cadence`, `task_digest_day_of_week`, etc. — see `server/digest.js`).
- `meetings` — one row per scheduled/held meeting (title, planned date/time, duration,
  status `planned`/`completed`/`cancelled`, optional `invite_send_date`, and
  `ics_sequence` — the iCalendar SEQUENCE number for the invite, incremented on every
  (re)send so a resend reads as an update rather than a stale duplicate).
- `meeting_attendees` — a meeting's planned attendees: either a family member
  (`user_id`) or an external invitee (`external_name`/`external_email`).
- `agenda_items` — one row per agenda item on a meeting, with `discussion_summary`
  filled in while recording minutes and `added_during_minutes` marking items added on
  the fly during the meeting rather than planned in advance.
- `meeting_decisions` / `meeting_action_items` — decisions and action items recorded
  against an agenda item. An action item is either a family action item (has an
  `assignee_user_id` and a `task_id` pointing at the Family Task List task it created)
  or a non-family action item (free-text `assignee_name`, no task created).

## Scheduled Task List digest

An hourly check (`server/digest.js`, started from `server/index.js`) compares the
current time against the configured cadence and emails each member their open tasks —
grouped high/medium/low priority (current quarter or overdue) first, then future
quarters, then unscheduled — via the same Microsoft Graph mailer used for Due Diligence
notifications. A Task List admin sets cadence/day/hour/timezone from the "Digest
Settings" panel on `/tasks`.

## Meetings module

Schedule a meeting (`/meetings`) with an agenda, planned attendees, and an optional
invite send date. If set, `server/meetings-scheduler.js` runs an hourly sweep
(`startMeetingsScheduler`, same pattern as the Task List digest) that emails a real
calendar invite to the meeting's **family** attendees only — external attendees are
never auto-invited by the app. An admin can also trigger it immediately via "Send Invite
Now."

**The invite is a hand-built iCalendar (`.ics`) file (`server/ics.js`), attached to a
normal email sent through the existing Mail.Send mailer — not created via the Graph
Calendar API.** That's a deliberate choice, not a simplification for its own sake:
creating a calendar event through Graph's *application* (app-only, no signed-in user)
permissions against a *shared* mailbox — which is what `MS_GRAPH_SENDER` is — has a
confirmed gap. The event gets created and something gets emailed, but Outlook never
fully treats it as a real trackable meeting: no Accept/Decline, never lands on the
recipient's calendar. This was verified directly by inspecting a real test invite via
Outlook automation — the message was tagged as a meeting request, but Outlook's own
typed meeting properties (Start/End/Organizer/RequiredAttendees) were empty, even though
the raw start-date property underneath had a value. A hand-built `METHOD:REQUEST` `.ics`
sidesteps this entirely, since it never goes through Graph's Calendar/Events endpoints —
any calendar-aware client recognizes a well-formed `.ics` attachment as a meeting
request regardless of how the email carrying it was sent. See `server/ics.js` for the
full explanation and RFC 5545 details.

Online-meeting links (Teams or otherwise) are out of scope for now — the invite is a
plain calendar meeting. If that's revisited later, the natural place to add it is
generating a join link (via whatever mechanism proves reliable for a shared mailbox) and
including it in the `.ics` `DESCRIPTION`/`LOCATION` fields, rather than going back to the
Graph Calendar API.

During the meeting, anyone with Meetings member/admin access records minutes against
each agenda item (discussion summary, decisions, family/non-family action items) and
can add new agenda items on the fly. Saving a family action item immediately creates a
linked task in the Family Task List, filed under whichever existing task category the
person recording minutes picks. When a Meetings admin marks the meeting complete, the
finished minutes are emailed to every family attendee; a completed meeting's minutes can
still be edited by an admin afterward, and re-sent via "Resend Minutes" (it is not
resent automatically). See `RFO_Meetings_App_BuildSpec_v1.docx` for the full spec.

## Deploying so the family can reach it

This is a single Node process serving both the API and the static frontend
(`public/home.html`, `public/due-diligence.html`, `public/tasks.html`,
`public/meetings.html`), so any Node host works. Two things matter for hosting choice:

1. **Persistent disk** — `data/ic.db` needs to survive restarts/redeploys. Serverless
   platforms (Vercel, Netlify functions) won't work as-is without swapping SQLite for a
   hosted Postgres. A host with a persistent volume (Railway, Render, Fly.io, a small VPS)
   works out of the box.
2. **Node version** — this uses Node's built-in `node:sqlite` (stable in Node 22.5+) to
   avoid a native-compiled dependency. Make sure your host runs Node 22.5 or newer
   (`package.json` pins `engines.node`).

Suggested minimal path on Railway or Render:
1. Push this `ic-app` folder to its own git repo (or a subfolder of one).
2. Create a new service pointing at it, build command `npm install`, start command
   `npm start`.
3. Attach a persistent volume mounted so `data/` survives deploys.
4. Set environment variables: `SESSION_SECRET`, `ANTHROPIC_API_KEY` (optional), `PORT`
   (most hosts set this for you).
5. Share the resulting URL with the family; each person signs in with their passcode.

## Security notes

- The unrelated `setup-rfo-notion.js` / `setup-rfo-responses.js` scripts in the parent
  folder have a **live Notion API token hardcoded in plaintext**. If you're abandoning
  that approach, rotate that token in Notion's integration settings and consider deleting
  those two files — they're not used by this app.
- Sessions are cookie-based and last 30 days; there's no "remember me" toggle. Signing
  out clears the cookie server-side.
- Passcodes are hashed with scrypt (Node's built-in `crypto`), not stored in plaintext.
