# RFO Maturity Assessment — Build Instructions

## 1. Purpose & Scope

Add a new module to the RFO umbrella app (`ic-app/`, alongside PQ Introduced Due
Diligence, Family Task List, Family Office Meetings, Household Expenditures, and Risk
Management) that operationalises the **Robinson Family Office Maturity Assessment**. It
replaces the `Appendix B - Maturity Scorecard.xlsx` spreadsheet (and its companion
radar chart) with a living application that:

- holds the standing **service catalogue** (5 service categories, 16 family-office
  services) and, for each service, a **clear, editable description of how that service
  could operate at each of the 5 maturity levels** — seeded verbatim from Appendix B and
  amendable in-app as the family's understanding sharpens;
- runs **periodic assessment rounds**: each family member answers a **concise set of
  questions about each service**, and a maturity level (1–5) is assigned from their
  answers;
- adds, for every service in every round, a **Claude external benchmark** — a web-search
  pass that reasons about how a comparable family office would operate this service and
  returns its own 1–5 assessment plus "what would move us up", as decision support beside
  the family's self-assessment (never as an override);
- keeps **history**: every round is snapshotted, so the register has a trend, not just a
  current state, and the central report answers the question the module exists to answer —
  **is the family office actually getting more efficient and effective over time?** For
  each reporting period it shows the **family self-reported averages** and the **Claude
  benchmarked score**, side by side, per service and in aggregate;
- carries a second lens — **Capital Consciousness** — drawn from the Mo Lidsky white
  paper *From Survival to Freedom: Navigating the Arc of Capital Consciousness* (Prime
  Quadrant). The maturity scorecard measures whether the family office is **doing things
  right**; the Capital Consciousness review asks whether it is **doing the right things**.
  Each member places themselves on the paper's 7-level arc, overall and across five
  decision domains; the module reports the family's centre of gravity, the **dispersion
  between members** (which the paper treats as where the most important work happens), and
  a **synthesis panel** that flags where operational maturity and consciousness are out of
  step;
- lets the user **add and change tasks in the Family Task List** directly from a service
  or a synthesis finding — every "Notes / Actions" entry in the scorecard can become (or
  link to) a real task under the existing Task List, the same mechanism the Risk module
  uses for "Required Actions";
- **refreshes the maturity ladder at the start of every cycle**: when a new assessment
  round is opened, Claude proposes updated language for all five level descriptors of
  every service — a web-search pass over how comparable family offices describe each
  level today — which a Maturity admin reviews line by line (accept / edit & accept /
  dismiss) *before* members start assessing. The ladder is meant to sharpen round over
  round, not stay frozen at the Appendix B wording.

**This is not a standalone app.** It is built inside the existing `ic-app` Node/Express
project in this repo, reusing its login, sessions, database (`data/ic.db`), mailer,
Claude proxy, PDF/chart stack, and page chrome — exactly the way Tasks, Meetings,
Household Expenditures, and Risk Management were added alongside the original Due
Diligence app. Read `ic-app/README.md`, `RFO_Risk_App_BuildSpec_v1.md` (the closest
precedent — taxonomy + point-in-time assessments + history + Claude web-search + PDF, all
of which this module mirrors), `RFO_Umbrella_TaskList_BuildSpec_v1.docx` (permission
model, umbrella structure), and `RFO_Expenditure_App_BuildSpec_v1.md` (the PDF/email
report stack this app reuses) before starting.

### 1.1 The two lenses — "doing things right" vs. "doing the right things"

The module is deliberately built around **two instruments per round**, reported together
but scored differently:

| | **Operational Maturity Scorecard** | **Capital Consciousness Review** |
|---|---|---|
| Question it answers | Are we *doing things right*? Is each family-office service well-run, efficient, effective? | Are we *doing the right things*? From what level of awareness are our capital decisions being made? |
| Source | `Appendix B - Maturity Scorecard.xlsx` | Mo Lidsky, *The Arc of Capital Consciousness* (ACC), Prime Quadrant |
| Structure | 16 services in 5 categories, each rated **1–5** via a short questionnaire | Each member self-places on a **1–7** arc, overall + across 5 decision domains |
| Rollup | Family mean per service + Claude benchmark; aggregate mean over all services; radar chart | Family **centre of gravity** and **dispersion** per domain; movement over rounds. *Not* reduced to a single averaged KPI — direction and spread matter more than the mean |
| Improvement framing | "What would move this service to the next level" (concrete, operational) | The paper's **Four Dimensions** of change — Physical, Intellectual, Emotional, Soulful |

The ACC arc (seeded, admin-editable — see §5.8):

| # | Level | Capital is… | One-line |
|---|---|---|---|
| 1 | Instinctive | …survival | Primal instincts drive decisions; fear is the editor |
| 2 | Competitive | …accumulation | Optimising within a narrow frame; fees, returns, benchmarks, peer comparison |
| 3 | Protective | …a shield | Structures to care for others; the gap is between protecting wealth and preparing people |
| 4 | Integrative | …a system | Capital seen and coordinated as one whole; the question of purpose becomes audible |
| 5 | Reflective | …a mirror | "Is this consistent with who we are? What is enough?" |
| 6 | Generative | …a force | Capital as a lever for outcomes in the world; an explicit theory of change |
| 7 | Transcendent | …freedom | Managed with full rigour, but no longer the centre of gravity or a source of identity |

Two forces run across the arc: the **circle of responsibility** widens (self → family →
community → society) while **emotional attachment** to capital loosens. They cross at
**Level 4** — the threshold from reactive to chosen. The report's synthesis (§8.3) uses
this: a service can be operationally mature (Level 4–5 on the scorecard) while the family's
consciousness on the matching decision domain is clustered at Level 2–3 or widely
dispersed — "well-run, unclear why", the Level-4 trap the paper describes. The inverse —
high consciousness, low operational maturity — reads as "the intent is there, the
machinery isn't."

## 2. Current State (what already exists)

Everything this module needs already exists in the umbrella — this app is almost entirely
**new tables + new module + new page**, with the same small set of touch-points in
existing code that the Risk module used.

| Capability | Where it lives today | How Maturity Assessment uses it |
|---|---|---|
| Auth, sessions, `requireAuth` | `server/auth.js`, `server/index.js` | Every route is `requireAuth`. |
| Per-app role columns (`dd_role`, `tasks_role`, `meetings_role`, `risk_role`) + `is_fo_admin` | migration `012`, `017`, `027`; `server/index.js` `PUT /api/admin/members/:userId/app-role` | Add a fifth axis, `maturity_role` (`admin`/`member`/`viewer`), default `member`. |
| Numbered migrations | `server/migrations/`, `server/migrate.js` (applied once, tracked by filename in `schema_migrations`, idempotent guards) | New migrations start at `033` (highest today is `032_risk_accountable_user.js`; `028` was skipped historically). |
| Module pattern | `server/tasks.js`, `server/meetings.js`, `server/expenditure.js`, `server/risk.js` — each exports `register<X>Routes(app, { db, logAudit })`, mounted from `server/index.js` | New `server/maturity.js` exporting `registerMaturityRoutes(app, { db, logAudit })`. |
| Static page routes | `server/index.js` (`app.get('/risk', …)` etc.) | Add `app.get('/maturity', …)` → `public/maturity.html`. |
| Seed-from-source-doc pattern | `server/risk-seed-data.js` transcribed from the risk spreadsheet + notes; applied by `server/seed.js` `ensureSeeded()` → `seedRiskRegister()`, guarded on row count, **not** a migration (baseline needs a real user) | New `server/maturity-seed-data.js` transcribed from `Appendix B - Maturity Scorecard.xlsx`; applied by a new `seedMaturity()` block in `ensureSeeded()`, same guard and placement. |
| Claude proxy + web search | `server/claude.js` — `research(type, opp)` and `researchRiskProbability(...)` use `tools: [{ type: 'web_search_20250305', name: 'web_search' }]`; `extractJson`; `ClaudeNotConfiguredError` when no `ANTHROPIC_API_KEY`; caller logs `logApiUsage` | Add `benchmarkMaturityService(...)`, `synthesizeMaturityRound(...)`, and `suggestLevelDescriptors(...)` — same tool, same `extractJson`, same graceful-degradation contract. |
| PDF + chart export | `server/risk-report.js` / `server/expenditure-report.js` — `pdfkit` + `chartjs-node-canvas` (both already in `package.json`, no browser), emailed via `server/mailer.js` (`sendMail({ to, subject, html, attachments })`) with `email-template.js`'s `emailShell` / `contentRow` / `paragraph` | New `server/maturity-report.js` exporting `buildMaturityReportPdf(...)`, same libraries, **no new dependency**. |
| Chart.js on the frontend | `public/risk.html` / `public/expenditure.html` load `https://unpkg.com/chart.js@4.5.1/dist/chart.umd.js` (within the existing `helmet` CSP `scriptSrc` allowlist — `unpkg.com` is allowed) + a `ChartCanvas` React wrapper | `public/maturity.html` loads the same URL and reuses the same wrapper for the **radar chart** (matches the spreadsheet's "Family Office Maturity Radar Chart") and the trend charts. |
| Home-page tile | `public/home.html` `GROUPS` → `strategic` group already has a **`Maturity Assessment` tile with `comingSoon: true`** (`icon: ICONS.gauge`) | Remove `comingSoon: true` and give it `href: '/maturity'`. No new tile markup. |
| Family Task List + its categories | migration `013` (`task_categories` seed; pillars `strategy` / `people` / `core-business` / `operations`), `server/tasks.js` (`POST /api/tasks`, `task_assignees`); Risk module's `risk_actions.task_id` link + `promote`/`unlink` | Maturity actions are created as `tasks` rows and linked back by id — the exact mechanism as `risk_actions.task_id` / `meeting_action_items.task_id`. The promote form exposes a **task-category picker** (any existing `task_categories` row) **defaulting to `strategy`**; no new category is added. |
| Hourly scheduler pattern | `server/digest.js`, `server/meetings-scheduler.js`, `server/risk-scheduler.js` (started from `server/index.js`, compare wall-clock to a cadence in `settings`) | Optional phase-2 assessment-round reminder — see §9. |
| Audit log | `server/audit.js` `logAudit({ userId, action, entityType, entityId, details })` | Log `maturity.round_opened`, `maturity.assessment_submitted`, `maturity.benchmark_run`, `maturity.round_closed`, `maturity.ladder_edited`, `maturity.cc_submitted`, `maturity.action_created`, etc. |

## 3. Naming & Umbrella Structure

- **Display name:** "Maturity Assessment" (matches the existing home-page tile). Eyebrow
  on the page: `Robinson Family Office`.
- **Route:** `/maturity`. **Page:** `public/maturity.html`. **Module:**
  `server/maturity.js`. **API prefix:** `/api/maturity/…`. **Table prefix:** `maturity_…`.
- **Home page:** in `public/home.html`, the `strategic` group's `Maturity Assessment` tile
  loses `comingSoon: true` and gains `href: '/maturity'`. Nothing else.
- **Nav chrome:** copy the `<nav class="nav">` markup and the `:root` palette
  (`--navy:#1B2A4A; --teal:#2A7D7B; --gold:#C9A84C; …` plus the light tints and the
  `--low/med/high` triplet) **verbatim from `public/risk.html`** — it is the newest page
  and its stylesheet is the reference for chips, pills, tabs, drawers, `kcards`, `tbl`,
  `scoresel`, and the modal that scrolls internally. Same brand mark (`RFO`), same
  "· Sign out" control, same `POST /api/logout` behaviour.
- This is a **shared-dataset** app like Tasks, Meetings, and Risk — one set of rounds,
  visible in full to everyone with any `maturity_role`. It is **not** partitioned like
  Household Expenditures. `is_fo_admin` **does** imply Maturity admin here.

## 4. Permission Model

Add one per-application role axis, exactly parallel to `tasks_role` / `meetings_role` /
`risk_role` (see `RFO_Umbrella_TaskList_BuildSpec_v1.docx` §4 for the full rationale).

- **`users.maturity_role`** — `admin` / `member` / `viewer`, **default `member`** (like
  Tasks / Meetings, unlike Risk — every family member is expected to complete an
  assessment). An `is_fo_admin` user is always also a Maturity admin.
- **Backfill migration** (part of `033`): add the column, then set initial roles:
  - **Reg Robinson** (`reg`) — `admin`. Also `is_fo_admin`.
  - **Sheri-Dawn Robinson** (`sd`) — `admin`. Also `is_fo_admin`.
  - **Ross Robinson** (`ross`) — `member`.
  - **Lucas Robinson** (`lucas`) — `member`.
  - Any other/new account — `member` (the column default).
- **Role capabilities:**
  | Action | viewer | member | admin |
  |---|---|---|---|
  | See the scorecard, radar, Capital Consciousness profile, progress dashboard, all reports | ✓ | ✓ | ✓ |
  | Generate / print / email a PDF report | ✓ | ✓ | ✓ |
  | **Complete / edit my own assessment** for the open round (service questionnaires + Notes/Actions) | | ✓ | ✓ |
  | **Complete / edit my own Capital Consciousness self-placement** for the open round | | ✓ | ✓ |
  | Run a **Claude benchmark** for a service, and the **round synthesis** | | ✓ | ✓ |
  | Create / edit **maturity actions**; promote an action to a Task List task | | ✓ (task creation still follows `tasks_role`, §6.6) | ✓ |
  | Edit the **level descriptors** and **question set** for a service | | | ✓ |
  | Edit the **service catalogue** (categories, services), the **5 level labels**, the **ACC ladder text & prompts** | | | ✓ |
  | **Open** a new round / **close** the open round (freezes a snapshot) | | | ✓ |
  | Edit **another member's** entries (e.g. enter a score on behalf of someone) | | | ✓ |
  | Set the **review cadence / reminder** settings | | | ✓ |
- **Roles panel:** `public/maturity.html` gets a "Roles" panel identical to the one in
  `public/risk.html` / `public/tasks.html`, calling the existing
  `PUT /api/admin/members/:userId/app-role` with `app: 'maturity'`. Add `'maturity'` to
  that route's allow-list and to the `column` / `appLabel` maps in `server/index.js`
  (currently `['dd', 'tasks', 'meetings', 'risk']`), and to `userPublic()` (add
  `maturityAdmin` / `maturityRole`, same shape as `riskAdmin` / `riskRole`).

## 5. Maturity Assessment — Data Model

All tables in the umbrella's existing `data/ic.db`, `maturity_`-prefixed, added via
numbered migrations in `server/migrations/` following the existing
`module.exports = function (db) { db.exec(...) }` pattern.

- `033_maturity_schema.js` — the `users.maturity_role` column + backfill, plus all
  `maturity_*` tables (`CREATE TABLE IF NOT EXISTS`, existence-guarded column add). **Schema
  only — no seed here.**
- **Seed** the categories, 16 services, the 5 level labels, the 80 level descriptors, the
  starter question set, the ACC ladder + dimensions + prompts, and the **baseline round**
  (the current Appendix B assessment, as an already-closed round) from a
  `server/maturity-seed-data.js` module — run from `server/seed.js`'s `ensureSeeded()`
  (new `seedMaturity()` block, after `seedRiskRegister()`), **not** a migration. The
  baseline round's member scores need a real `submitted_by` / `user_id`, and migrations
  run before any user exists. Guard it the way the other `ensureSeeded()` blocks are —
  no-op if `maturity_services` already has rows — so it is safe on every boot.

### 5.1 Reference data — service catalogue

```
maturity_service_groups
  id            TEXT PRIMARY KEY        -- 'strategic-services', 'people', 'investment-services', 'legacy-services', 'operations'
  name          TEXT NOT NULL           -- 'Strategic Services', ...
  sort_order    INTEGER NOT NULL

maturity_services
  id            TEXT PRIMARY KEY        -- 'svc-01' .. 'svc-16' (stable; not the display number)
  group_id      TEXT NOT NULL REFERENCES maturity_service_groups(id)
  number        INTEGER NOT NULL        -- 1..16, display order
  name          TEXT NOT NULL           -- 'Governance'
  description   TEXT NOT NULL DEFAULT ''-- short standing note on what this service covers (optional; seed blank unless Appendix B implies one)
  sort_order    INTEGER NOT NULL
  is_active     INTEGER NOT NULL DEFAULT 1  -- soft-retire; retired services stay for history
```

### 5.2 The maturity ladder — 5 levels, editable descriptors

The requirement *"for each family-office service … a clear and editable description of how
that service could operate at each of the 5 maturity levels"* is these two tables.

```
maturity_level_labels                   -- 5 rows, global, admin-editable
  level         INTEGER PRIMARY KEY     -- 1..5
  name          TEXT NOT NULL           -- 1 'Ad Hoc', 2 'Emerging', 3 'Established', 4 'Institutionalized', 5 'Leading Practice'
  blurb         TEXT NOT NULL DEFAULT ''-- one-line generic description of the level, level-independent of service

maturity_level_descriptors              -- 16 services × 5 levels = 80 rows
  id            TEXT PRIMARY KEY
  service_id    TEXT NOT NULL REFERENCES maturity_services(id)
  level         INTEGER NOT NULL        -- 1..5
  text          TEXT NOT NULL           -- the editable "how this service operates at this level" paragraph (Appendix B columns C..G)
  updated_at    TEXT NOT NULL
  updated_by    TEXT REFERENCES users(id)
  UNIQUE (service_id, level)
```

- Descriptors are **edited in place** (there is no descriptor history table). Instead,
  when a round moves from `draft` to `open` it snapshots the whole ladder into
  `maturity_rounds.ladder_json` (§5.4), so a past round's report always renders against
  the descriptors as they were worded then. This is the same "snapshot the labels, don't
  bitemporal the taxonomy" decision the Risk module made.
- The 5 **level labels** are global. Renaming one (e.g. "Institutionalized" → "Embedded")
  updates every service at once; it does not change any assigned scores.

**Claude-proposed descriptor language (per round).** At the start of every cycle — while
the round is still `draft` — a Maturity admin can ask Claude to propose refreshed wording
for the level descriptors, all 16 services at once (§7.3). Suggestions land in a review
queue; accepting one writes the new `text` onto `maturity_level_descriptors` (and is then
captured in the `ladder_json` snapshot when the round opens). Nothing changes until an
admin accepts it.

```
maturity_descriptor_suggestions
  id            TEXT PRIMARY KEY
  round_id      TEXT NOT NULL REFERENCES maturity_rounds(id)   -- the draft round this batch was generated for
  service_id    TEXT NOT NULL REFERENCES maturity_services(id)
  level         INTEGER NOT NULL       -- 1..5
  current_text  TEXT NOT NULL          -- the descriptor as it stood when the suggestion was made (for the side-by-side)
  suggested_text TEXT NOT NULL         -- Claude's proposed replacement
  rationale     TEXT NOT NULL DEFAULT ''   -- one or two sentences: what changed and why
  sources       TEXT NOT NULL DEFAULT '[]' -- JSON array of {title, url}
  status        TEXT NOT NULL DEFAULT 'pending'  -- 'pending' | 'accepted' | 'accepted_edited' | 'dismissed'
  applied_text  TEXT                   -- what was actually written on accept (may differ from suggested_text if the admin edited it)
  model         TEXT NOT NULL
  searched_at   TEXT NOT NULL
  reviewed_by   TEXT REFERENCES users(id)
  reviewed_at   TEXT
  UNIQUE (round_id, service_id, level)  -- re-running the suggestion for a round replaces the batch
```

### 5.3 The questionnaire — how a number gets assigned

The requirement *"each family member should answer a concise set of questions about each
service, so that a number can be assigned"*.

```
maturity_questions
  id            TEXT PRIMARY KEY
  service_id    TEXT NOT NULL REFERENCES maturity_services(id)
  prompt        TEXT NOT NULL           -- 'We have documented, board-approved policies for this service and they are followed in practice.'
  help_text     TEXT NOT NULL DEFAULT ''-- optional clarifier
  response_kind TEXT NOT NULL           -- 'scale_1_5' (Strongly disagree .. Strongly agree, mapped 1..5)
                                        -- | 'level_pick' (member picks which of the 5 descriptors best fits; the pick IS the level)
  weight        REAL NOT NULL DEFAULT 1 -- relative weight in the service rollup
  sort_order    INTEGER NOT NULL
  is_active     INTEGER NOT NULL DEFAULT 1
```

- **Concise by design:** seed **3–5 questions per service**, no more. The set is
  admin-editable from the service drawer and the Manage tab.
- **Rollup rule (constant in `server/maturity.js`, not a table):** a member's assigned
  level for a service in a round =
  - if every question is `level_pick`: the **weighted mean of the picks**, rounded to the
    nearest 0.5 (the spreadsheet uses half-steps like 3.5);
  - if `scale_1_5`: weighted mean of the 1–5 responses, rounded to nearest 0.5;
  - mixed sets: mean across all answered questions on the 1–5 line, nearest 0.5.
  Mirror this one function verbatim in `public/maturity.html` and
  `server/maturity-report.js`, exactly as `scoreOf` / `bandOf` are mirrored in the Risk
  module.
- A member may also **override** the computed level with a direct pick plus a short
  rationale (`method = 'direct'` on the score row) — for services where the questionnaire
  feels wrong. The computed value is retained alongside so the report can show both.
- **Starter question sets** are derived from the level descriptors — each question is a
  statement that is true at higher levels and false at lower ones. See §5.7 for the
  worked example and the transcription instruction.

### 5.4 Rounds — a reporting period

One row per assessment cycle. A round is:

- **`draft`** — being set up. The admin can run the Claude descriptor-suggestion pass
  (§7.3) and review/accept refreshed level wording, adjust the service list, and choose
  carry-forward. The ladder is **not** frozen yet.
- **`open`** — members are completing it. Moving `draft` → `open` snapshots the ladder
  into `ladder_json` and (if configured) runs the all-services benchmark pass (§7.1).
- **`closed`** — the admin has finalised it; `maturity_round_snapshots` is written.

**The set of closed rounds is the history** that powers every trend in §8. The
**earliest closed round with benchmarks** is the comparison anchor (`is_anchor = 1`) —
every "since last round" and trend baseline is measured from it unless the report
explicitly picks another pair.

```
maturity_rounds
  id            TEXT PRIMARY KEY
  label         TEXT NOT NULL           -- '2026 Baseline (Appendix B)', '2026 H2', '2027 H1'
  status        TEXT NOT NULL           -- 'draft' | 'open' | 'closed'
  period_start  TEXT                    -- optional ISO date the round nominally covers
  period_end    TEXT
  opened_at     TEXT
  opened_by     TEXT REFERENCES users(id)
  closed_at     TEXT
  closed_by     TEXT REFERENCES users(id)
  notes         TEXT NOT NULL DEFAULT ''
  ladder_json   TEXT NOT NULL DEFAULT '{}'  -- frozen copy of {services, level_labels, level_descriptors, questions} taken at the draft->open transition
  carried_from  TEXT REFERENCES maturity_rounds(id)  -- if answers were pre-filled from a prior round
  is_anchor     INTEGER NOT NULL DEFAULT 0  -- exactly one closed round: the baseline all comparisons default to
  synthesis_json TEXT                    -- the last Claude round-synthesis result (§7.2), or NULL
```

- **Only one round may be `open` (or `draft`) at a time.** Opening a round with a
  `carried_from` pre-populates each member's `maturity_service_scores` and
  `maturity_cc_responses` from that round as an editable starting point (members adjust
  rather than start blank).
- **Closing** a round: sets `status='closed'`, stamps `closed_at`, writes
  `maturity_round_snapshots` (§8b). If no round yet has `is_anchor = 1` and this round has
  benchmarks, it becomes the anchor. A closed round is immutable except for admin edits to
  `notes` and re-running the synthesis narrative.
- **The baseline is the first real assessment, not the seed.** The Appendix B content is
  seeded as a `closed` round for reference (§5.7), but it carries **no benchmarks and is
  not the anchor**. The first cycle the family actually runs in-app — questionnaires
  completed, all 16 benchmarks generated, round closed — becomes `is_anchor` and every
  later round is compared against it.

### 5.5 Responses and scores

```
maturity_responses                      -- one row per (round, service, member, question)
  id            TEXT PRIMARY KEY
  round_id      TEXT NOT NULL REFERENCES maturity_rounds(id)
  service_id    TEXT NOT NULL REFERENCES maturity_services(id)
  user_id       TEXT NOT NULL REFERENCES users(id)
  question_id   TEXT NOT NULL REFERENCES maturity_questions(id)
  value         REAL NOT NULL           -- 1..5
  note          TEXT NOT NULL DEFAULT ''
  updated_at    TEXT NOT NULL
  UNIQUE (round_id, service_id, user_id, question_id)

maturity_service_scores                 -- one row per (round, service, member): the assigned level
  id            TEXT PRIMARY KEY
  round_id      TEXT NOT NULL REFERENCES maturity_rounds(id)
  service_id    TEXT NOT NULL REFERENCES maturity_services(id)
  user_id       TEXT NOT NULL REFERENCES users(id)
  level         REAL NOT NULL           -- 1..5, half-steps allowed
  computed_level REAL                   -- what the questionnaire produced, kept even when overridden
  method        TEXT NOT NULL           -- 'questionnaire' | 'direct'
  rationale     TEXT NOT NULL DEFAULT ''
  submitted     INTEGER NOT NULL DEFAULT 0  -- 0 = draft, 1 = member has submitted this service
  submitted_at  TEXT
  UNIQUE (round_id, service_id, user_id)
```

- **Family self-reported figures per (round, service)** — computed on read, not stored:
  `mean` = average of `level` over members who have `submitted = 1`; also `min`, `max`,
  and `spread = max − min` (the spreadsheet's L / M / N columns). A member who has not
  submitted a given service is simply absent from that service's mean — never counted as
  a zero or a placeholder.
- **Round completion for a member** = they have `submitted = 1` on every active service
  *and* submitted their Capital Consciousness placement (§5.8). The Assessment tab shows
  this as a progress bar.

### 5.6 Claude benchmark — one per (round, service)

```
maturity_benchmarks
  id              TEXT PRIMARY KEY
  round_id        TEXT NOT NULL REFERENCES maturity_rounds(id)
  service_id      TEXT NOT NULL REFERENCES maturity_services(id)
  benchmark_level REAL NOT NULL          -- 1..5, half-steps allowed
  rationale       TEXT NOT NULL          -- 2–4 plain-English sentences
  what_would_move_up TEXT NOT NULL DEFAULT '[]'  -- JSON array of concrete next-level actions
  sources         TEXT NOT NULL DEFAULT '[]'     -- JSON array of {title, url}
  caveats         TEXT NOT NULL DEFAULT ''       -- what the external comparison does NOT capture for this family
  model           TEXT NOT NULL
  searched_by     TEXT NOT NULL REFERENCES users(id)
  searched_at     TEXT NOT NULL
  UNIQUE (round_id, service_id)          -- re-running replaces the row
```

- Populated by `POST /api/maturity/rounds/:id/benchmark` (§7.1) — one service
  (`?serviceId=`) or all sixteen. Each call logs `logApiUsage` as the other
  `server/claude.js` callers do.
- On `ClaudeNotConfiguredError` the benchmark simply isn't produced; the scorecard's
  Benchmark and Gap columns render "—" and everything else works. Same graceful
  degradation as the DD research fields.

### 5.7 Seed data — service catalogue, ladder, questions, baseline round

Seed from `Appendix B - Maturity Scorecard.xlsx`, transcribed into
`server/maturity-seed-data.js`. **Fix the spreadsheet's typos on transcription** and leave
a `// SOURCE TYPO:` comment at each: `Strategfic → Strategic` (row E2), `priortities →
priorities` (row D2), the double space in `Finance,  Admin and Compliance` (row B13),
`benchmarked` duplication in G3. Do not carry them forward.

**5 categories, 16 services** (`group` · `#` · `name`):

| Category | # | Service |
|---|---|---|
| Strategic Services | 1 | Strategy |
| Strategic Services | 2 | Governance |
| Strategic Services | 3 | Risk Management |
| People | 4 | Family Relationships |
| People | 5 | Develop Capabilities |
| People | 6 | Family Wellness |
| Investment Services | 7 | Passive Investment |
| Investment Services | 8 | Direct Investment |
| Legacy Services | 9 | Philanthropy |
| Legacy Services | 10 | Estate Planning |
| Legacy Services | 11 | Tax Planning |
| Operations | 12 | Finance, Admin and Compliance |
| Operations | 13 | IT Management and Cybersecurity |
| Operations | 14 | Legal |
| Operations | 15 | External Relationships |
| Operations | 16 | External Communication |

**5 level labels:** `1 Ad Hoc` · `2 Emerging` · `3 Established` · `4 Institutionalized` ·
`5 Leading Practice`.

**80 level descriptors** — transcribe **verbatim** from Appendix B columns C (level 1)
through G (level 5), one string per (service, level). These are the editable "how this
service could operate at each maturity level" texts. The full grid to transcribe
(abridged here to level 1 and level 5 as the transcription check; levels 2–4 come from
columns D–F of the same rows):

| Service | Level 1 (Ad Hoc) — col C | Level 5 (Leading Practice) — col G |
|---|---|---|
| Strategy | No documented vision, values, or priorities | Regular confirmation that the family is living the shared values and prioritising the family priorities |
| Governance | No formal governance. Decisions made informally by one or two family members. No documented roles or processes. | Governance benchmarked against peers. Ongoing governance training and development. Next-gen leadership pipelines established. Governance continuously improved and benchmarked. |
| Risk Management | Risks handled case-by-case. Minimal insurance. No monitoring. | Continuous monitoring of risks with technology. Global regulatory alignment. Horizon scanning for emerging risks (e.g. AI, ESG). Risk culture embedded across family and staff. |
| Family Relationships | Minimal communication. Tensions unmanaged. Family meetings rare or absent. | Strong culture of trust. Multi-gen cohesion programmes. Family values integrated in practice. Proactive communication fosters resilience. Family culture nurtured intentionally. |
| Develop Capabilities | No intentional development of family capabilities. Knowledge and decision-making concentrated in a few individuals. | Family viewed as a learning system. Continuous development of leadership, decision-making, and stewardship capabilities across generations. Learning goals reviewed regularly and aligned with succession roles. |
| Family Wellness | Wellness left to individuals. No consideration in family-office policies. | Wellness embedded as a strategic priority. Preventive, intergenerational approach supporting long-term health, resilience, and balance. |
| Passive Investment | Investments made opportunistically, often based on relationships or intuition. Limited diversification strategy. Performance rarely tracked or documented. | Sophisticated portfolio construction and analytics. Peer benchmarking and continuous refinement of strategy. |
| Direct Investment | Direct investments pursued opportunistically. Limited due diligence or governance. | Institutional-quality direct-investment platform with disciplined sourcing, governance, and performance evaluation. |
| Philanthropy | Giving is reactive, based on requests or personal passion. No central tracking. | Philanthropy recognised as a core family activity. Thoughtful, collaborative, and transparent impact leadership. Family demonstrates leadership in community. |
| Estate Planning | Basic wills exist, outdated. No unified estate plan. Heirs not informed. | Comprehensive multi-gen wealth and legacy strategy. Next-gen actively leading in governance or philanthropy. Plan regularly updated to reflect global and regulatory changes. |
| Tax Planning | Tax matters handled reactively and transaction-by-transaction. | Highly proactive and strategic tax management integrated into all major decisions. |
| Finance, Admin and Compliance | Reliance on Excel and email. Processes undocumented. No separation of duties. Paper records common. | Fully digital, automated workflows. AI or data analytics used for forecasting. Real-time consolidated reporting across entities. Continuous improvement of operations. |
| IT Management and Cybersecurity | Personal devices used. No cyber protocols. Outsourced IT informal. | Zero-trust security, 24/7 monitoring, phishing simulations, cyber risk integrated into governance reviews. |
| Legal | Legal issues addressed only when problems arise. | Strategic legal governance aligned with family objectives and best practices. |
| External Relationships | Advisor relationships informal and transactional. | Deep, long-term relationships with best-in-class advisors and a well-functioning inter-relationship between advisors. |
| External Communication | No intentional external communication. Reactive responses only. | Highly intentional external presence supporting reputation, privacy, and influence. |

*(Levels 2–4 for every row: transcribe columns D, E, F of the same spreadsheet rows 2–17.
`maturity-seed-data.js` must carry all 80 in full.)*

**Starter question set — worked example (Governance, `svc-02`), `response_kind:
'level_pick'` unless noted:**

1. "How are significant family-office decisions actually made today?" — *level_pick*
   (member chooses the descriptor C–G that best matches).
2. "We have written charters for our governance bodies (council / board / committees) with
   roles and responsibilities assigned." — *scale_1_5*.
3. "A succession plan exists and is actively monitored, not just drafted." — *scale_1_5*.
4. "The next generation is involved in governance in a way that is appropriate to their
   age and capability." — *scale_1_5*.
5. "We have benchmarked our governance against peer family offices in the last two years."
   — *scale_1_5*.

Author an equivalent 3–5 question set for each of the other 15 services, each question
phrased so that agreement indicates a higher level. Keep them plain-language and
answerable by any family member in under a minute per service.

**Reference round (not the anchor)** — seed one round, `label: '2026 Baseline
(Appendix B)'`, `status: 'closed'`, `is_anchor: 0`, `period_end` = the file's effective
date, `opened_by` / `closed_by` = `reg`, `ladder_json` = the seeded ladder. It exists so
the seeded scorecard has somewhere to live and so the first real round has something to
carry forward from — it is **not** the trend baseline. The first cycle the family runs
in-app (with benchmarks) becomes `is_anchor` (§5.4). Transcribe the member scores from
Appendix B columns H (Reg), I (Ross), J (Lucas), K (SD) into `maturity_service_scores`
with `method: 'direct'`, `submitted: 1`, `computed_level: NULL`:

| # | Service | Reg (H) | Ross (I) | Lucas (J) | SD (K) |
|---|---|---|---|---|---|
| 2 | Governance | 3.5 | 3 | 2.5 | 3 |
| 3 | Risk Management | 3 | 2 | 1.5 | 3 |
| 4 | Family Relationships | 5 | 5 | 2 | 3.5 |
| 5 | Develop Capabilities | 3.5 | 3 | 1.5 | 3 |
| 6 | Family Wellness | 3.5 | 1.5 | 2 | 3 |
| 7 | Passive Investment | 4 | 5 | 4 | 4 |
| 9 | Philanthropy | 3 | 3 | 3 | 3.5 |
| 10 | Estate Planning | 4.5 | 3 | 2 | 3.5 |
| 12 | Finance, Admin and Compliance | 3.5 | 3 | 2 | 3.5 |
| 13 | IT Management and Cybersecurity | 2.5 | 1 | 2 | 2.5 |

- **Services 1 (Strategy), 8 (Direct Investment), 11 (Tax Planning), 14 (Legal), 15
  (External Relationships), 16 (External Communication)** — Appendix B carries only a
  placeholder mean of `3` for these and no member cells. Seed them with **no
  `maturity_service_scores` rows** (they read as "not assessed in the baseline round").
  Do **not** fabricate a `3`. Leave a `// SOURCE: Appendix B placeholder mean only —
  seeded as not-yet-assessed` comment.
- No `maturity_responses` rows for the reference round (the questionnaire didn't exist
  yet) and **no `maturity_benchmarks`** — the reference round is deliberately
  benchmark-free so it cannot be mistaken for the anchor. Benchmarks are first generated
  when the family closes their first real round.

### 5.8 Capital Consciousness — the ACC lens (Mo Lidsky white paper)

```
maturity_cc_levels                      -- 7 rows, admin-editable
  level         INTEGER PRIMARY KEY     -- 1..7
  name          TEXT NOT NULL           -- 'Instinctive', 'Competitive', ... 'Transcendent'
  tagline       TEXT NOT NULL           -- 'Capital as survival', ... 'Capital as freedom'
  description   TEXT NOT NULL           -- 2–4 sentences from the white paper's "The Seven Levels" section

maturity_cc_dimensions                  -- 6 rows: 'Overall' + the paper's 5 decision domains
  id            TEXT PRIMARY KEY        -- 'overall','investment','tax-structure','estate-succession','philanthropy-impact','advisory'
  name          TEXT NOT NULL           -- 'Overall', 'Investment Decisions', 'Tax & Structure', 'Estate & Succession', 'Philanthropy & Impact', 'Advisory Relationships'
  sort_order    INTEGER NOT NULL
  service_ids   TEXT NOT NULL DEFAULT '[]'  -- JSON: which maturity_services this domain is cross-referenced with in the synthesis (§8.3)

maturity_cc_prompts                     -- reflective questions, admin-editable
  id            TEXT PRIMARY KEY
  dimension_id  TEXT NOT NULL REFERENCES maturity_cc_dimensions(id)
  prompt        TEXT NOT NULL
  sort_order    INTEGER NOT NULL

maturity_cc_responses                   -- one row per (round, member, dimension)
  id            TEXT PRIMARY KEY
  round_id      TEXT NOT NULL REFERENCES maturity_rounds(id)
  user_id       TEXT NOT NULL REFERENCES users(id)
  dimension_id  TEXT NOT NULL REFERENCES maturity_cc_dimensions(id)
  level         INTEGER NOT NULL        -- 1..7, the member's self-placement
  reflection    TEXT NOT NULL DEFAULT ''
  submitted     INTEGER NOT NULL DEFAULT 0
  updated_at    TEXT NOT NULL
  UNIQUE (round_id, user_id, dimension_id)
```

- **Seed `maturity_cc_levels`** from §1.1's table + the white paper's "The Seven Levels"
  narrative (2–4 sentences each, quoting the paper's own descriptions of what each level
  looks like from the inside).
- **Seed `maturity_cc_dimensions`** with `Overall` + the five decision domains from the
  paper's "Consciousness and Decision: A Map of Errors" matrix. Seed `service_ids`:
  `investment` → [Passive Investment, Direct Investment]; `tax-structure` → [Tax
  Planning]; `estate-succession` → [Estate Planning]; `philanthropy-impact` →
  [Philanthropy]; `advisory` → [Governance, External Relationships]; `overall` →
  [Strategy, Family Relationships, Develop Capabilities].
- **Seed `maturity_cc_prompts`** — 1–3 per dimension, adapted from the paper's "Common
  Challenges at this level" and "Bridge to the next level" lists, plus George Kinder's
  three-question prompt for the `overall` dimension ("Imagine you have 5–10 years to live
  in perfect health — what would you do differently?").
- **The ACC is not averaged into one KPI.** The report shows, per dimension: each member's
  dot on the 1–7 arc, the family's **centre of gravity** (median, not mean), the
  **dispersion** (range and whether members straddle the Level-4 threshold), and movement
  vs. the prior round. The paper is explicit that "some of the most important work happens
  precisely in those differences."
- **Four Dimensions of change** (`Physical` / `Intellectual` / `Emotional` / `Soulful`)
  — a constant list in `server/maturity-seed-data.js`, offered as an optional tag on a
  `maturity_action` created from the Capital Consciousness tab, and shown as a framing
  panel. Not a table.
- **Attribution constant** (`ACC_ATTRIBUTION` in the seed module) — a short paragraph
  crediting the framework: *Mo Lidsky, PhD — "From Survival to Freedom: Navigating the
  Arc of Capital Consciousness", Prime Quadrant* — rendered in a disclosure on the
  Capital Consciousness tab. Do not reproduce the white paper itself in the app.

### 5.9 `maturity_actions` — "Notes / Actions", linked to the Family Task List

```
maturity_actions
  id            TEXT PRIMARY KEY
  round_id      TEXT REFERENCES maturity_rounds(id)   -- the round it was raised in; nullable for standing actions
  service_id    TEXT REFERENCES maturity_services(id) -- nullable: a synthesis-level action may not map to one service
  dimension_id  TEXT REFERENCES maturity_cc_dimensions(id)  -- set when the action came from the Capital Consciousness tab
  title         TEXT NOT NULL
  detail        TEXT NOT NULL DEFAULT ''
  target_level  REAL                                  -- the maturity level this action is meant to reach (services only)
  change_dimension TEXT                               -- 'Physical'|'Intellectual'|'Emotional'|'Soulful' (CC actions), nullable
  priority      TEXT NOT NULL DEFAULT 'Active'        -- 'Immediate' | 'Active' | 'Monitor'  (RAG, same as risk_actions)
  owner_text    TEXT NOT NULL DEFAULT ''
  due_quarter   TEXT
  status        TEXT NOT NULL DEFAULT 'open'          -- 'open' | 'in_progress' | 'done'
  task_id       TEXT REFERENCES tasks(id)             -- set when promoted to a Family Task List task; NULL otherwise
  completed_at  TEXT
  archived_at   TEXT                                  -- soft-delete, so a past round's report still shows the action existed
  created_by    TEXT NOT NULL REFERENCES users(id)
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL
```

- Same Task List link contract as `risk_actions`: `task_id` is the single source of truth
  for "is this a real task yet"; once set, status/owner/due are read **through** the
  linked `tasks` row; `DELETE` soft-archives; a deleted linked task leaves `task_id`
  dangling and the row falls back to its own `status` (so `task_id` is a plain column,
  not an FK-with-cascade — mirror migration `029`'s reasoning).
- Seed the baseline round's actions from Appendix B column O ("Notes / Actions") where any
  cell is populated (the current file has O blank for every row, so expect zero seeded
  actions — the column is there for future rounds).

## 6. Maturity Assessment — Screens & Interactions

Single-page React app (`public/maturity.html`), same build-free pattern as the other five
pages: `React.createElement` aliased to `h`, one inline `<script>`, no JSX, no bundler.
Fetch helper with the `credentials: 'same-origin'` + 401-redirect pattern used by every
other page. Gate write UI on `me.maturityAdmin` / `me.maturityRole`; gate the Task List
promote control on `me.tasksRole` / `me.tasksAdmin`.

Tabs across the top: **Assessment** · **Scorecard** · **Capital Consciousness** ·
**Progress** · (admin only) **Manage**.

### 6.1 Assessment tab (member/admin) — "my worksheet for the open round"

The only place a member enters data. Shows the `open` round's label and a **completion
progress bar** ("9 of 16 services + Capital Consciousness — 60%").

- If no round is `open`: an empty state ("No assessment round is open. An administrator
  opens one from the Manage tab.") plus, for admins, an "Open a round" shortcut.
- **Per service** (grouped by the 5 categories, collapsible): the service name, its
  one-line level-3 descriptor as context, and the **3–5 questions**:
  - `level_pick` questions render the 5 descriptors as a single-select list (the picked
    descriptor's level is the answer).
  - `scale_1_5` questions render a 5-button `scoresel` (Strongly disagree → Strongly
    agree).
  - A live **"Computed level: 3.5"** updates as questions are answered, with a
    **"Adjust"** link to override (direct pick + rationale).
  - A **"Notes / Actions"** textarea (feeds `maturity_actions` on submit if non-empty —
    prompt "turn this into an action?").
  - **"Submit this service"** sets `submitted = 1` for that (round, service, member).
- **Capital Consciousness section** at the foot of the tab: the 6 dimensions, each with
  the 1–7 arc as a labelled slider/`scoresel`, the level name+tagline shown for the
  current pick, the reflective prompt(s), and a reflection textarea. "Submit Capital
  Consciousness."
- **"Submit my whole assessment"** — enabled once every active service + Capital
  Consciousness is submitted; `logAudit('maturity.assessment_submitted')`. Re-opening and
  editing before the round closes is allowed.

### 6.2 Scorecard tab (all roles) — the Appendix B view

A round selector (defaults to the latest `closed` round, or the `open` one if a member is
mid-assessment). The 16 services grouped by the 5 categories, each category collapsible
with a category-level mean.

Per service row: number, name, a **per-member level chip** (Reg / Ross / Lucas / SD — one
column each, "—" if not submitted), then **Min · Mean · Max · Spread**, then the **Claude
Benchmark** chip, then **Gap** (`benchmark − family mean`, coloured: benchmark ahead =
amber/"room to improve", family ahead = teal, within ±0.5 = neutral), then an
open-actions count.

- Colour the level chips on a 5-step ramp reusing the page palette: 1–1.5 uses the
  `--high` treatment, 2–2.5 amber, 3–3.5 `--navy-l`, 4–4.5 `--teal-l`, 5 `--low`
  treatment. One `levelClass(level)` helper, mirrored into the PDF.
- Toggle: **Family mean / Benchmark / Both** — controls which value the row and the radar
  emphasise.
- Filters: category, "benchmark gap ≥ 1", "not yet assessed this round", "declined vs.
  previous round".
- A small **radar chart** at the top of the tab (Chart.js `radar`, scale 0–5, one spoke
  per service): family mean as one series, benchmark as a second, and optionally the
  previous round's family mean as a faint third. This is the in-app version of the
  spreadsheet's "Family Office Maturity Radar Chart".
- Click a row → the **Service drawer** (§6.3).

### 6.3 Service drawer — the single place a service is managed

Opens from a Scorecard row. Read-only for viewers; member/admin can edit as noted.
Header (sticky): number, name, family mean → benchmark chips, round label.

One scrolling panel (no sub-tabs), in this order:

- **The 5 maturity levels** — the `maturity_level_descriptors` for this service, each
  shown with its label. **Admin: inline "✎ Edit" per level** →
  `PUT /api/maturity/services/:id/descriptors/:level`. This is the *only* place the
  "editable description of how the service operates at each of the 5 levels" is edited.
  - **Proposed wording (Claude)** — when the `draft` round has
    `maturity_descriptor_suggestions` for this service (§5.2, §7.3), each level shows a
    **current vs. suggested** side-by-side with the rationale and sources. Admin controls
    per suggestion: **Accept** (writes `suggested_text`), **Edit & accept** (opens the
    text for tweaking, then writes), **Dismiss**. Accepting before the round opens means
    the new wording is what gets frozen into `ladder_json`. A "Accept all / Dismiss all
    for this service" pair sits at the top of the panel.
- **Questions ( N )** — the service's question set. **Admin:** add / edit / reorder /
  retire, `response_kind` and `weight` per question.
- **This round's scores** — a small table: each member's `level`, `method`,
  `computed_level`, `rationale`, submitted-at. Admin may edit a cell on a member's behalf.
- **Claude benchmark** — `benchmark_level`, `rationale`, the **"What would move us up"**
  list, `sources` (as links), `caveats`, and "last run `<date>` by `<name>`". A
  **"Run / re-run benchmark"** button (member/admin) → §7.1. Disabled with a tooltip when
  Claude is not configured.
- **Trend** — this service's family mean and benchmark across all closed rounds, as a
  sparkline + a tiny table.
- **Notes / Actions ( N open of M )** — the service's `maturity_actions`, grouped
  Immediate / Active / Monitor, with inline "+ Add action" and the per-action **RFO Task
  List** sync toggle (§6.6).

### 6.4 Capital Consciousness tab (all roles)

- **The arc** — the 7 `maturity_cc_levels` as a labelled scale, each with its tagline and
  description (admin: inline edit).
- **Family placement** — for each of the 6 dimensions, a horizontal 1–7 track with a dot
  per member (initials), the **centre of gravity** (median) marked, the **range** shaded,
  and a caret showing movement since the previous round. A dimension whose members
  straddle Level 4 is flagged ("members are on both sides of the reactive → chosen
  threshold").
- **Reflections** — each member's `reflection` text per dimension, shown together so the
  family can read across (this is the point — surfacing what people believe but haven't
  said).
- **The Four Dimensions of change** — a static panel (Physical / Intellectual / Emotional
  / Soulful) explaining how movement actually happens, with a "Create a development
  action" button that opens the `maturity_actions` form pre-tagged with the chosen
  dimension.
- **Map of Errors** — the synthesis panel, §8.3, also surfaced here (not only in the PDF):
  per decision domain, the family's consciousness centre of gravity next to the mean
  operational maturity of the mapped services, with a one-line read where they diverge.
- Attribution disclosure at the foot (`ACC_ATTRIBUTION`).

### 6.5 Progress tab (all roles) — "is the family office actually improving?"

The reason the module exists. All read-only; every row links into a drawer.

- **Radar overlay** — family mean for the latest closed round vs. the round before, plus
  the benchmark, on one 0–5 radar.
- **Headline trend** — a line/bar chart with two series over all closed rounds:
  **family self-reported aggregate mean** (average of service means) and **Claude
  benchmarked aggregate mean**. The gap between the lines is the "how honest / how
  ambitious" signal.
- **Per-service movement** — a table of every service: previous mean → current mean (Δ),
  benchmark, and a mini sparkline; sortable; **"most improved" / "most declined"**
  highlighted.
- **Capital Consciousness trend** — the family centre-of-gravity per dimension across
  rounds (small multiples), and a note on dispersion widening or narrowing.
- **Changes since last round** — pick two closed rounds (default: latest vs. previous);
  table of every service whose family mean, or benchmark, or open-action count changed,
  before → after; plus every dimension whose centre of gravity moved.
- **Round synthesis** — the latest `synthesis_json` narrative (§7.2), rendered, with a
  "re-generate" button (member/admin).
- **Review snapshots** — the list of closed rounds with "view" (read-only frozen
  scorecard) and "PDF", and a "Take a snapshot of the open round" button for an interim
  checkpoint.

### 6.6 Notes / Actions — per-action Family Task List sync

Identical contract to the Risk module's §6.5, managed inline in the service drawer (and,
for synthesis-level actions, from the Capital Consciousness tab):

- Each action row carries a **"RFO Task List"** toggle. **Off (default):** managed here,
  a small Open / In progress / Done select drives `maturity_actions.status`. **On:**
  flipping it opens a compact assign form (title, **task category** — a `<select>` of
  every `task_categories` row, **defaulted to `strategy`** — priority → `high` if
  `Immediate` else `medium`, target quarter from `due_quarter`, assignee(s) from
  `/api/members` or "All family"); `POST /api/maturity/actions/:id/promote` (body carries
  `categoryId`) creates a `tasks` row in the chosen category with a `"From Maturity —
  <service> — <title>"` back-reference and stores `task_id`. Thereafter the row reads the
  linked task's live status/assignees through.
- Flipping **off** → `POST /api/maturity/actions/:id/unlink` (confirm first); clears
  `task_id`, leaves the task in the list.
- The "on" direction requires `tasks_role` member/admin; the toggle is disabled with a
  tooltip otherwise.
- Mirrors `meeting_action_items → tasks` and `risk_actions → tasks`. No new task schema.

### 6.7 Manage tab (admin only)

Global configuration only — per-service level descriptors and questions are edited from
the service drawer (§6.3).

- **Service catalogue** — add / rename / retire a **category**; add / rename / retire /
  reorder a **service** (retire = soft, keeps history). New empty service shows on the
  Scorecard once it has a descriptor set.
- **Level labels** — edit the 5 `maturity_level_labels` names and blurbs. Note in the UI
  that the 1–5 count and the rollup rule are fixed in code.
- **ACC configuration** — edit the 7 `maturity_cc_levels` texts, the 6 dimensions
  (name, `service_ids` mapping), and the `maturity_cc_prompts`.
- **Rounds** — the round lifecycle:
  - **Start a round (`draft`)** — label, optional `period_start`/`period_end`, and an
    optional **"carry answers forward from <round>"** checkbox. Refuses if a round is
    already `draft` or `open`.
  - **Review the ladder** (draft only) — a **"Ask Claude to propose refreshed level
    wording"** button runs §7.3 for all 16 services at once; the results open in a
    **descriptor-suggestion review table** (service × level, current vs. suggested,
    rationale, Accept / Edit & accept / Dismiss, plus "Accept all" / "Dismiss all"). The
    same suggestions are also reachable from each service drawer (§6.3). Pending
    suggestions do not block opening the round — anything left `pending` is simply
    dropped when the round opens.
  - **Open the round** — sets `status='open'`, snapshots `ladder_json` (with whatever
    descriptor edits were accepted), and — if the "benchmark on open" box is ticked —
    kicks off the all-services benchmark pass (§7.1).
  - **Close the open round** — confirmation; sets `status='closed'`, writes the snapshot
    (§8b), sets `is_anchor = 1` if it is the first closed round with benchmarks,
    optionally triggers the synthesis.
  - Per round: edit `notes`, re-run synthesis, re-run or backfill benchmarks, re-run the
    descriptor-suggestion pass (draft only).
- **Roles panel** — as in `/risk` (§4).
- **Review cadence** — the settings for the optional reminder (§9).

## 7. External Benchmarking (Claude web search)

Add to `server/claude.js`, following `researchRiskProbability(...)` exactly (same
`web_search_20250305` tool, same `extractJson`, same `ClaudeNotConfiguredError` /
"not configured" degradation, same `logApiUsage` by the caller).

### 7.1 `benchmarkMaturityService(...)` — per-service 1–5 assessment

```js
// Assesses how a comparable family office would operate a specific service, and returns
// its own 1–5 maturity rating plus concrete "what would move up" actions, as decision
// support for a maturity assessment round (see RFO_Maturity_App_BuildSpec_v1.md §6.3).
// The family still records its own score independently.
async function benchmarkMaturityService({ serviceName, description, levelDescriptors, familyContext, selfAssessedLevel }) {
  // system: "You are helping a Canadian single-family office (Robinson Family Office,
  //   Ontario, ~CAD $30M AUM, multi-generational — three couples across two generations)
  //   assess the maturity of one of its operating services against how comparable family
  //   offices operate. Search the web for family-office operating benchmarks, industry
  //   surveys (e.g. from banks, KPMG/EY/PwC/Deloitte family-office practices, Campden,
  //   the Family Office Exchange, UBS/Citi/BNY family-office reports), and credible
  //   practitioner writing. Be explicit about how well the external norms fit a family
  //   office of THIS size and complexity — a $30M SFO should not be held to a $2B family
  //   office's standard. Today is <date>."
  // user: "Service: <serviceName>. <description>.
  //   The family defines five maturity levels for this service as follows:
  //   1 (Ad Hoc): <levelDescriptors[1]>
  //   2 (Emerging): <levelDescriptors[2]>
  //   3 (Established): <levelDescriptors[3]>
  //   4 (Institutionalized): <levelDescriptors[4]>
  //   5 (Leading Practice): <levelDescriptors[5]>
  //   Family context: <familyContext>.
  //   The family's own current self-assessment is <selfAssessedLevel> (for your reference
  //   only — assess independently).
  //   Return ONLY valid JSON, no markdown:
  //   {"benchmarkLevel": 3.5,          // 1..5, halves allowed, on the family's own scale above
  //    "rationale": "2-4 plain-English sentences a non-expert can follow",
  //    "whatWouldMoveUp": ["concrete action 1", "concrete action 2", "concrete action 3"],
  //    "sources": [{"title":"...","url":"..."}],   // the 2-4 most load-bearing
  //    "caveats": "one sentence on what this external comparison does NOT capture for this family"}"
  // tools: [{ type: 'web_search_20250305', name: 'web_search' }], max_tokens ~3500
}
```

Route: `POST /api/maturity/rounds/:id/benchmark` (member/admin) — body `{ serviceId? }`;
with no `serviceId`, iterate all active services (sequentially, logging usage per call).
Persists / replaces `maturity_benchmarks` rows and returns them. On
`ClaudeNotConfiguredError` returns `{ configured: false }` and the UI shows the
manual-only state.

`familyContext` is a single constant assembled in `server/maturity.js` (size, structure,
jurisdiction, the fact that PQ is the introducing advisor, the presence of the Risk
Register and Task List apps) — keep it in one place so every call is consistent, the same
way the Risk module builds its research context.

### 7.2 `synthesizeMaturityRound(...)` — the round narrative

```js
// Produces the round's written synthesis: an overall read on "are we doing things right"
// (operational maturity) AND "are we doing the right things" (Capital Consciousness /
// the Arc of Capital Consciousness), the 3–5 highest-value priorities, and a short peer
// comparison. See RFO_Maturity_App_BuildSpec_v1.md §1.1 and §8.3.
async function synthesizeMaturityRound({ services, ccProfile, priorRound, familyContext }) {
  // services: [{ name, category, familyMean, benchmarkLevel, prevFamilyMean }]
  // ccProfile: [{ dimension, memberLevels: [..], centreOfGravity, range, prevCentre }]
  // system: explains the two-lens model (Appendix B maturity scorecard = "doing things
  //   right"; the Arc of Capital Consciousness, Mo Lidsky / Prime Quadrant = "doing the
  //   right things"), the seven ACC levels, the two forces, and the Level-4 threshold.
  //   Search the web only for peer-comparison colour, not for the family's own numbers.
  // user: the JSON above + "Return ONLY valid JSON:
  //   {"doingThingsRight": "3-5 sentences on operational maturity, trend, and the widest gaps",
  //    "doingTheRightThings": "3-5 sentences reading the Capital Consciousness profile —
  //        centre of gravity, dispersion, movement, and what the paper would say about it",
  //    "mapOfErrors": [{"domain":"Investment Decisions","read":"one sentence where maturity and consciousness diverge"}],
  //    "priorities": ["the 3-5 highest-value things to work on before the next round"],
  //    "peerComparison": "2-3 sentences",
  //    "sources": [{"title":"...","url":"..."}]}"
  // tools: [{ type: 'web_search_20250305', name: 'web_search' }], max_tokens ~4000
}
```

Route: `POST /api/maturity/rounds/:id/synthesis` (member/admin) — computes the inputs
server-side, calls Claude, stores the result on `maturity_rounds.synthesis_json`, returns
it. Not run automatically on close unless the admin opts in at close time.

### 7.3 `suggestLevelDescriptors(...)` — refreshed ladder wording each cycle

Runs once per service at the **start of a cycle**, while the round is `draft`. Proposes
replacement text for all five level descriptors so the ladder keeps pace with how
comparable family offices describe each level. Same `web_search_20250305` +
`extractJson` + `ClaudeNotConfiguredError` + `logApiUsage` contract as §7.1.

```js
// Proposes updated language for the five maturity-level descriptors of one service, at
// the start of an assessment cycle (see RFO_Maturity_App_BuildSpec_v1.md §5.2, §6.7).
// Output is a review queue for a Maturity admin — nothing is applied automatically.
async function suggestLevelDescriptors({ serviceName, description, levelLabels, currentDescriptors, familyContext }) {
  // system: "You are helping a Canadian single-family office (Robinson Family Office,
  //   Ontario, ~CAD $30M AUM, multi-generational) keep its maturity model current. For
  //   ONE operating service you are given the five level descriptors it uses today
  //   (1 Ad Hoc ... 5 Leading Practice). Search the web for how family-office maturity
  //   models, operating benchmarks, and practitioner writing describe each of these
  //   levels for this service now, and propose tighter, clearer, more current wording.
  //   Keep each descriptor to 1-3 sentences, keep the family's own level names, keep the
  //   progression monotonic (each level a clear step up), and stay realistic for a family
  //   office of THIS size. Preserve anything already good — only change what genuinely
  //   improves clarity or currency. Today is <date>."
  // user: "Service: <serviceName>. <description>.
  //   Current descriptors:
  //   1 (<levelLabels[1]>): <currentDescriptors[1]>
  //   ... 5 (<levelLabels[5]>): <currentDescriptors[5]>
  //   Family context: <familyContext>.
  //   Return ONLY valid JSON, no markdown:
  //   {"levels":[
  //     {"level":1,"suggestedText":"...","rationale":"one or two sentences on what changed and why","changed":true},
  //     ... through level 5 ],
  //    "sources":[{"title":"...","url":"..."}]}"   // 'changed:false' => keep the current text
  // tools: [{ type: 'web_search_20250305', name: 'web_search' }], max_tokens ~4000
}
```

Route: `POST /api/maturity/rounds/:id/suggest-descriptors` (admin, round must be
`draft`) — body `{ serviceId? }`; with no `serviceId`, iterate all 16 active services
(sequentially, logging usage per call). Replaces any existing
`maturity_descriptor_suggestions` rows for `(round, service)` and returns them.
`POST /api/maturity/descriptor-suggestions/:id/accept` (admin — optional `{ text }`
override; writes `maturity_level_descriptors`, sets `status` to `accepted` /
`accepted_edited`, stamps `applied_text`, `reviewed_by`, `reviewed_at`;
`logAudit('maturity.descriptor_accepted')`) and
`POST /api/maturity/descriptor-suggestions/:id/dismiss` (admin). On
`ClaudeNotConfiguredError` the button is disabled with a tooltip and the ladder is edited
by hand as before.

**Framing in the UI (important):** the benchmark and synthesis are **decision support**,
shown beside — never replacing — the family's own scores. Persist both. Where an external
comparison is weak (Family Relationships, Family Wellness, the person-specific parts of
Capital Consciousness), the `caveats` field will say so — that is a feature. Cache the
last benchmark per (round, service) with its `searched_at` so it is not re-run casually
(each call costs a few cents and some seconds).

## 8. Reporting & Export

- **On-screen:** the Scorecard (§6.2), Capital Consciousness (§6.4), and Progress (§6.5)
  tabs are the primary report.
- **PDF** — new `server/maturity-report.js` exporting
  `async function buildMaturityReportPdf({ roundId, compareToRoundId })`, using `pdfkit`
  + `chartjs-node-canvas` (both already dependencies; **no new package**),
  pattern-for-pattern with `server/risk-report.js`:
  - Cover: "Robinson Family Office — Family Office Maturity Assessment", the round label,
    generated date, the aggregate family mean and aggregate benchmark, and the headline
    "improving / holding / slipping vs. `<compareTo>`" line.
  - **Radar chart** as a rendered PNG (`chartjs-node-canvas`, `radar`, scale 0–5,
    `backgroundColour: 'white'`): family mean, benchmark, and the comparison round.
  - The **scorecard** grouped by the 5 categories: per service, the four member levels,
    Min / Mean / Max / Spread, Benchmark, Gap, and the level-3 descriptor for context.
  - **"What would move us up"** — the benchmark `whatWouldMoveUp` bullets per service.
  - **Capital Consciousness** — the 1–7 arc per dimension with each member's placement,
    the centre of gravity, the dispersion, and movement vs. the comparison round; the
    reflections; the attribution line.
  - **Map of Errors** — the synthesis `mapOfErrors` table.
  - **Round synthesis** — `doingThingsRight`, `doingTheRightThings`, `priorities`,
    `peerComparison`.
  - **Changes since `<compareTo>`** — the per-service and per-dimension diff.
  - **Open actions** grouped Immediate / Active / Monitor, with owner, due quarter, and a
    marker for those linked to a live Task List task.
- **Routes:** `GET /api/maturity/report/pdf?round=<id>&compareTo=<id>` (streams the PDF,
  `Content-Type: application/pdf`) and `POST /api/maturity/report/email`
  (`{ to: [...], subject?, round, compareTo }` → `mailer.sendMail({ to, subject, html,
  attachments: [{ … base64 … }] })`, reusing `email-template.js`'s `emailShell` /
  `contentRow` / `paragraph`). Both available to all roles. "Print" in the UI = open the
  PDF route in a new tab; "Email as PDF" = a small recipient form → the email route.

### 8b. Historical data & round snapshots

Closed rounds are already immutable; this closes the remaining gap for verbatim
historical reporting.

- **`maturity_round_snapshots(id, round_id, taken_at, taken_by, label, payload)`** —
  `payload` is the full round serialised by `buildRoundModel(roundId)` at close time (or
  at an interim "take a snapshot" click): services, level labels + descriptors as worded
  then, every member score, benchmarks, family means, the Capital Consciousness responses,
  the synthesis, and open actions.
  - Written automatically on **close**; also `POST /api/maturity/rounds/:id/snapshot`
    (member+) for an interim checkpoint on the open round.
  - `GET /api/maturity/snapshots` lists; `GET /api/maturity/snapshots/:id` returns the
    payload; `GET /api/maturity/snapshots/:id/pdf` renders the historical PDF straight
    from the frozen payload. `DELETE` is admin-only.
- **`maturity_actions`** already carries `completed_at` + `archived_at`; all action reads
  filter `archived_at IS NULL`, so a past round's PDF still reconstructs the actions that
  were open then.
- Not doing full bitemporal history on the service catalogue — snapshots capture the
  service names and descriptors as they were, which covers the reporting need (same
  decision as the Risk module).

### 8.3 The synthesis — "doing things right" × "doing the right things"

Computed in `server/maturity.js` (`buildSynthesisModel(roundId)`) and rendered both in
the Capital Consciousness tab (§6.4) and the PDF (§8):

- For each of the 5 decision domains in `maturity_cc_dimensions` (excluding `Overall`):
  - **operational maturity** = mean family level over the domain's mapped `service_ids`
    for the round;
  - **capital consciousness** = family centre of gravity (median member level) on that
    dimension for the round;
  - **read** — a rule-of-thumb label the Claude synthesis then expands in prose:
    - maturity ≥ 4 and consciousness ≤ 3 → *"well-run, purpose not yet articulated"* (the
      Level-4 trap);
    - maturity ≤ 2.5 and consciousness ≥ 4 → *"clear intent, machinery lagging"*;
    - dispersion ≥ 3 on the dimension → *"family members are far apart here — dialogue
      before decisions"*;
    - otherwise → *"aligned"*.
- The `Overall` dimension is reported on its own: family centre of gravity on the arc, the
  spread across the four members, and movement across rounds — framed with the paper's
  two forces (circle of responsibility widening; attachment loosening) rather than a
  pass/fail.

## 9. Scheduled Assessment Reminders (optional — phase 2)

Mirror `server/digest.js` / `server/risk-scheduler.js`: an hourly sweep started from
`server/index.js` that, on a cadence stored in `settings`
(`maturity_review_cadence`, `maturity_review_day_of_week`, `maturity_review_hour_local`,
`maturity_review_timezone`, `maturity_review_enabled`):

- when a round is `open`: emails members who have not yet submitted a nudge with their
  outstanding service count and a link to `/maturity`;
- when no round is `open` and the cadence interval since the last `closed_at` has elapsed:
  emails the Maturity admins to open the next round.

Same Microsoft Graph mailer, same `email-template.js` shell. Ship §§1–8 first; this is
additive and touches no schema beyond `settings` keys.

## 10. Implementation Checklist (file-by-file)

### 10.1 New migration (`ic-app/server/migrations/`)

- **`033_maturity_schema.js`** — `ALTER TABLE users ADD COLUMN maturity_role TEXT NOT
  NULL DEFAULT 'member'` (guard with a `PRAGMA table_info(users)` existence check, same
  as `012` / `017` do); backfill `reg`/`sd` → `admin`, `ross`/`lucas` → `member`; create
  `maturity_service_groups`, `maturity_services`, `maturity_level_labels`,
  `maturity_level_descriptors`, `maturity_descriptor_suggestions`, `maturity_questions`,
  `maturity_rounds` (incl. `is_anchor`), `maturity_responses`,
  `maturity_service_scores`, `maturity_benchmarks`, `maturity_actions`,
  `maturity_round_snapshots`, `maturity_cc_levels`, `maturity_cc_dimensions`,
  `maturity_cc_prompts`, `maturity_cc_responses` with `CREATE TABLE IF NOT EXISTS`.
  **Schema only — no seed here.**
- Later small migrations as issues surface.

### 10.2 Server changes

- **`server/maturity-seed-data.js`** (new) — `GROUPS` (5), `SERVICES` (16, with typo
  fixes + `// SOURCE TYPO:` comments), `LEVEL_LABELS` (5), `LEVEL_DESCRIPTORS` (80,
  verbatim from Appendix B C–G), `QUESTIONS` (3–5 per service), `CC_LEVELS` (7),
  `CC_DIMENSIONS` (6, with `service_ids`), `CC_PROMPTS`, `CHANGE_DIMENSIONS`
  (`['Physical','Intellectual','Emotional','Soulful']`), `ACC_ATTRIBUTION`, and
  `REFERENCE_ROUND` (the closed, benchmark-free, non-anchor "2026 Baseline (Appendix B)"
  round with the 10 transcribed member-score rows from §5.7 and the 6 not-assessed
  services flagged). Transcription target — this is the step to get exactly right.
- **`server/seed.js`** — add a `seedMaturity()` block to `ensureSeeded()` (after
  `seedRiskRegister()`), idempotent on `maturity_services` row count, consuming
  `maturity-seed-data.js`. Seed order: groups → services → level labels → descriptors →
  questions → CC levels/dimensions/prompts → the reference round + its score rows +
  its snapshot (`is_anchor = 0`). Log a one-line summary like `seedRiskRegister` does.
- **`server/maturity.js`** (new) — `registerMaturityRoutes(app, { db, logAudit })`. All
  routes `requireAuth`, role-checked via a local `myRoles(userId)` helper reading
  `is_fo_admin` + `maturity_role` + `tasks_role` (copy `server/risk.js`'s `myRoles`). The
  `levelRollup(responses, questions)` and `levelClass(level)` helpers live here and are
  copied verbatim into `public/maturity.html` and `server/maturity-report.js`.
  - `GET /api/maturity/overview?round=<id>` — groups, services each with the round's
    per-member scores, family min/mean/max/spread, benchmark, open-action count, and the
    level descriptors (the Scorecard payload).
  - `GET /api/maturity/services/:id?round=<id>` — full detail: descriptors, questions,
    every member's score + responses, benchmark, per-round trend, actions.
  - `GET /api/maturity/rounds` / `GET /api/maturity/rounds/:id` — list + detail incl.
    completion per member.
  - `POST /api/maturity/rounds` (admin — start a `draft`),
    `POST /api/maturity/rounds/:id/open` (admin — draft → open; snapshots `ladder_json`,
    optional benchmark kick-off), `POST /api/maturity/rounds/:id/close` (admin — sets
    `is_anchor` if first closed round with benchmarks), `PUT /api/maturity/rounds/:id`
    (admin — notes).
  - `POST /api/maturity/rounds/:id/suggest-descriptors` (admin, draft only — §7.3; body
    `{ serviceId? }`), `GET /api/maturity/rounds/:id/descriptor-suggestions` (admin —
    the review queue), `POST /api/maturity/descriptor-suggestions/:id/accept` (admin —
    optional `{ text }`), `POST /api/maturity/descriptor-suggestions/:id/dismiss`
    (admin).
  - `PUT /api/maturity/responses` (member/admin — upsert a batch of the caller's
    `maturity_responses` for one service; recomputes and upserts the
    `maturity_service_scores` row), `POST /api/maturity/services/:id/submit` (member/admin
    — set `submitted=1` for the caller), `PUT /api/maturity/scores/:id` (admin — edit on
    another member's behalf; also the caller's own direct override).
  - `PUT /api/maturity/cc-responses` (member/admin — upsert the caller's placements),
    `POST /api/maturity/cc/submit`.
  - `POST /api/maturity/services` (admin), `PUT /api/maturity/services/:id` (admin),
    `PUT /api/maturity/services/:id/descriptors/:level` (admin),
    `POST/PUT/DELETE /api/maturity/services/:id/questions[/:qid]` (admin).
  - `PUT /api/maturity/level-labels/:level` (admin),
    `PUT /api/maturity/cc-levels/:level` (admin),
    `POST/PUT/DELETE /api/maturity/cc-dimensions[/:id]` (admin),
    `POST/PUT/DELETE /api/maturity/cc-prompts[/:id]` (admin).
  - `GET /api/maturity/actions`, `POST/PUT/DELETE /api/maturity/actions[/:id]`
    (member/admin); `POST /api/maturity/actions/:id/promote` (creates the `tasks` row —
    reuse the shared helper the Risk module factored, or duplicate the small INSERT) and
    `POST /api/maturity/actions/:id/unlink`.
  - `POST /api/maturity/rounds/:id/benchmark` (member/admin — §7.1; all 16 services in
    one call unless `?serviceId=`), `POST /api/maturity/rounds/:id/synthesis`
    (member/admin — §7.2).
  - `GET /api/maturity/profile?round=<id>` — radar points, aggregate means (current +
    historical series), per-service movement, CC centre-of-gravity series, changes-since.
  - `GET /api/maturity/snapshots`, `GET /api/maturity/snapshots/:id[/pdf]`,
    `POST /api/maturity/rounds/:id/snapshot`, `DELETE /api/maturity/snapshots/:id`
    (admin).
  - `GET /api/maturity/report/pdf`, `POST /api/maturity/report/email` — all roles; §8.
- **`server/maturity-report.js`** (new) — `buildMaturityReportPdf({ roundId,
  compareToRoundId })`, copy the structure of `server/risk-report.js` (its `chartCanvas`,
  `renderToBuffer`, page/table helpers). Radar via `chartjs-node-canvas` `radar`.
- **`server/claude.js`** — add `benchmarkMaturityService(...)`,
  `synthesizeMaturityRound(...)`, and `suggestLevelDescriptors(...)` (§7); add all three
  to `module.exports`.
- **`server/index.js`** —
  - `const registerMaturityRoutes = require('./maturity');` and
    `registerMaturityRoutes(app, { db, logAudit });` next to the other `register…Routes`
    calls.
  - `app.get('/maturity', (req, res) => res.sendFile(path.join(PUBLIC_DIR,
    'maturity.html')));` next to the other page routes.
  - In `PUT /api/admin/members/:userId/app-role`: add `'maturity'` to the `app`
    allow-list, the `column` map (`maturity_role`), and the `appLabel` map
    (`Maturity Assessment`).
  - In `userPublic(row)`: add `maturityAdmin: isFoAdmin || row.maturity_role === 'admin'`
    and `maturityRole: row.maturity_role`.
  - Optional (§9): `const { startMaturityReviewScheduler } =
    require('./maturity-scheduler');` started alongside the others.
- **`server/maturity-scheduler.js`** (new, optional / phase 2) — §9.
- **Tests** (`node --test`, matching `test/risk*.test.js`): the `levelRollup` /
  `levelClass` functions; family min/mean/max/spread over submitted scores only;
  aggregate-mean historical series across rounds; "only one draft/open round"
  enforcement; `is_anchor` assignment on first benchmarked close; carry-forward pre-fill;
  descriptor-suggestion accept writes `maturity_level_descriptors` and is captured in the
  next `ladder_json`; action↔task link read-through and unlink fallback;
  `benchmarkMaturityService` / `synthesizeMaturityRound` / `suggestLevelDescriptors` JSON
  parsing incl. `stop_reason === 'max_tokens'` and the not-configured path; the
  reference-round seed (10 scored services, 6 not-assessed, means match Appendix B,
  `is_anchor = 0`, no benchmarks).

### 10.3 Frontend changes

- **`public/maturity.html`** (new) — React 18 + `chart.js@4.5.1` from `unpkg.com` (three
  `<script src>` tags, copy from `public/risk.html`); nav chrome + full `:root` palette +
  the shared component classes copied from `public/risk.html`; tabs Assessment /
  Scorecard / Capital Consciousness / Progress / Manage; the `ChartCanvas` wrapper copied
  from `public/risk.html` / `public/expenditure.html`, used for `radar` and the trend
  charts. Gate write UI on `me.maturityAdmin` / `me.maturityRole`; gate the promote
  control on `me.tasksRole` / `me.tasksAdmin`. Includes the **descriptor-suggestion
  review** UI — the per-level current-vs-suggested panel in the service drawer (§6.3) and
  the batch table in Manage (§6.7) — with Accept / Edit & accept / Dismiss and
  accept-all / dismiss-all.
- **`public/home.html`** — in `GROUPS` → `strategic` → the `Maturity Assessment` tile:
  delete `comingSoon: true`, add `href: '/maturity'`. Nothing else.

### 10.4 README / docs

- `ic-app/README.md`:
  - Add "Maturity Assessment (`/maturity`)" to the umbrella app list at the top.
  - Add the `maturity_*` tables and `users.maturity_role` to the Data model section.
  - Note the new `maturity_role` axis in Permissions (five per-app roles now: `dd_role`,
    `tasks_role`, `meetings_role`, `risk_role`, `maturity_role`; `maturity_role` defaults
    to `member`).
  - If §9 ships, add a "Scheduled maturity-review reminder" note next to the other
    scheduler notes.
- This file (`RFO_Maturity_App_BuildSpec_v1.md`) is the full spec; keep it beside the
  other `RFO_*_BuildSpec` docs in the repo root, with a `.docx` copy.

## 11. Suggested Build Order

1. **Schema + roles:** `033_maturity_schema.js` (tables + `maturity_role` + backfill) and
   the `server/index.js` role wiring (`app-role` route, `userPublic`). Confirm the
   existing `node --test` suite still passes.
2. **Seed:** `server/maturity-seed-data.js` + a `seedMaturity()` block in `ensureSeeded()`.
   Transcribe Appendix B — the 16 services, the 80 level descriptors, the reference
   round's 10 member-score rows (`is_anchor = 0`, no benchmarks). Eyeball the seeded
   scorecard against the spreadsheet (means, min/max) and against the radar chart's
   cached values. **This is the step to get right.**
3. **Scorecard read path:** `GET /api/maturity/overview`, `GET /api/maturity/services/:id`,
   and the Scorecard tab + read-only service drawer. Verify it reproduces Appendix B and
   its radar.
4. **Rounds + Assessment tab:** the `draft` → `open` → `closed` lifecycle, the
   per-service questionnaire → computed level, submit, completion progress. Start a second
   round carrying the reference round forward and confirm pre-fill + history.
5. **Editable ladder + questions:** descriptor edit per level in the drawer, question
   authoring in the drawer + Manage tab.
6. **Descriptor suggestions (§7.3):** `suggestLevelDescriptors`, the draft-round
   suggest-all route, the review queue (Manage batch table + per-service drawer panel),
   accept/edit/dismiss writing `maturity_level_descriptors`. Confirm accepted edits show
   up in the `ladder_json` snapshot when the round opens. Test the not-configured path.
7. **Capital Consciousness:** the 7-level ladder, the 6 dimensions, member self-placement,
   the dispersion view, reflections.
8. **Claude benchmark + synthesis (§7):** `benchmarkMaturityService` (all 16 at once),
   `synthesizeMaturityRound`, the routes, the drawer + Progress UI, `is_anchor` on first
   benchmarked close. Test the not-configured path.
9. **Progress dashboard (§6.5):** radar overlay, self vs. benchmark aggregate trend,
   per-service movement, CC trend, changes-since-anchor, `GET /api/maturity/profile`.
10. **Notes / Actions + Task List sync (§6.6):** the per-action toggle, the task-category
    picker (default `strategy`), `promote` / `unlink`, the read-through join. Test
    sync-from-service, complete-in-`/tasks`-reflects, delete-task fallback.
11. **PDF + email report (§8) + snapshots (§8b).**
12. **Home tile + README.**
13. **(Phase 2) Review-reminder scheduler (§9).**

Check in real output at steps 2, 3, and 9 (the seeded scorecard, the reproduced grid, the
progress numbers) rather than building straight through — the point of the app is that
these match the family's Appendix B position and then show movement from it.

## 12. Decided (no longer open)

- **Not a standalone app** — a sixth module inside `ic-app`, same stack (Node/Express,
  `node:sqlite`, React-via-CDN, `pdfkit` + `chartjs-node-canvas`), same login/DB/mailer,
  same page chrome (copied from `public/risk.html`).
- **Shared dataset**, not ledger-partitioned. One set of rounds, visible to every role;
  `is_fo_admin` implies Maturity admin. Fifth per-app role axis `maturity_role`
  (`admin`/`member`/`viewer`), **default `member`** (every family member assesses).
- **Two lenses per round:** the **Operational Maturity Scorecard** (Appendix B — "doing
  things right", 16 services × 1–5, questionnaire-driven) and the **Capital Consciousness
  Review** (Mo Lidsky's Arc of Capital Consciousness — "doing the right things", 1–7 arc
  × 6 dimensions, self-placement). Reported together; scored differently (maturity is
  averaged, consciousness is read for centre-of-gravity + dispersion).
- **The 5 maturity levels and their per-service descriptors are editable in-app**
  (`maturity_level_descriptors`), seeded verbatim from Appendix B; the 1–5 count and the
  rollup rule are fixed in code; the 5 level *labels* are admin-editable.
- **A number is assigned from a concise questionnaire** (3–5 questions per service),
  `levelRollup` to the nearest 0.5, with an optional direct override + rationale.
- **Every service in every round gets a Claude web-search benchmark** 1–5 on the family's
  own scale, plus a round-level synthesis narrative — decision support beside the family's
  scores, never replacing them; degrades to manual when `ANTHROPIC_API_KEY` is unset.
  Same contract as the Risk module's `researchRiskProbability`.
- **Rounds are the unit of history**, and run `draft` → `open` → `closed`. Only one
  `draft`/`open` round at a time; closing freezes a `maturity_round_snapshots` payload.
  The set of closed rounds powers every trend and the central "is the family office
  improving?" report — family self-reported aggregate vs. Claude benchmarked aggregate,
  per service and overall.
- **The ladder is refreshed each cycle.** While a round is `draft`,
  `suggestLevelDescriptors` (§7.3) proposes new wording for all 80 descriptors (16
  services × 5 levels); a Maturity admin accepts / edits / dismisses each; accepted
  wording is frozen into that round's `ladder_json` when it opens. Nothing is applied
  without an admin accept.
- **The trend baseline is the first real assessment, not the seed.** The Appendix B data
  is seeded as a `closed`, benchmark-free, non-anchor **reference round** ("2026 Baseline
  (Appendix B)") — 10 services with transcribed member scores, 6 marked not-assessed (not
  a fabricated 3). The first cycle the family runs in-app (questionnaires done, all 16
  benchmarks generated, round closed) is stamped `is_anchor = 1`, and every later round
  is compared against it.
- **`maturity_role` = `admin` / `member` / `viewer`, default `member`** — every family
  member self-assesses by default; a `viewer` is read-only. Only the FO admins (Reg,
  Sheri-Dawn) are Maturity admins; Ross and Lucas are `member` (self-assess only — they
  cannot open/close rounds or edit another member's scores).
- **Every member answers the concise per-service questionnaire** (3–5 questions,
  `levelRollup` to nearest 0.5), with an optional direct override + rationale. All 6
  Capital Consciousness dimensions (Overall + 5 decision domains) are placed every round.
- **Benchmarks run all 16 services at once**, on demand — from the Manage tab or, if the
  box is ticked, automatically when a round opens — plus the one round synthesis.
- **Task List integration goes through the existing Task List** — `maturity_actions.task_id`
  links to a real `tasks` row, exactly like `risk_actions.task_id`; no parallel task
  store; task mutation stays under `tasks_role`. The promote form's category picker lists
  every `task_categories` row and **defaults to `strategy`**; no new category is added.
- **Reports** reuse the Risk / Expenditure `pdfkit` + `chartjs-node-canvas` + Graph-mailer
  stack — no new dependency. The radar chart matches the spreadsheet's "Family Office
  Maturity Radar Chart".

## 13. Still open — confirm before/while building

1. **Phase-2 reminder (§9)** — wanted now, or genuinely deferred? Needs only `settings`
   keys, no schema.
2. **Reproducing the white paper** — spec deliberately keeps only a short attribution
   constant and adapts the level/prompt text, rather than embedding
   *The Arc of Capital Consciousness* in the app. Confirm that is acceptable, or whether a
   link/soft copy should be attached on the Capital Consciousness tab.
3. **Descriptor-suggestion cost** — the start-of-cycle pass is 16 `suggestLevelDescriptors`
   web-search calls on top of the 16 benchmark calls (~30+ calls, several dollars, a few
   minutes per cycle). Fine as an explicit admin action once per cycle (spec), or should
   it be per-service on demand only?
