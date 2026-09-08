# RFO Risk Management — Build Instructions

## 1. Purpose & Scope

Add a new module to the RFO umbrella app (`ic-app/`, alongside PQ Introduced Due
Diligence, Family Task List, Family Office Meetings, and Household Expenditures) that
operationalises the **Robinson Family Office Enterprise Risk Register**. It replaces the
`RFO_Risk_Register_v5.xlsx` spreadsheet and its companion `RFO_Risk_Register_Notes_v5.docx`
with a living application that:

- holds the standing **risk taxonomy** (6 domains, 14 risk categories) and lets an admin
  amend it;
- lets members **log and manage risk events** — actual incidents, near-misses, and
  materialisations — against a category;
- records **point-in-time risk assessments** (inherent and residual Probability × Impact,
  status, mitigations, rationale) so the register has history, not just a current state;
- **reports** on the register — the full grid grouped by domain, a 4×4 heatmap, an overall
  **risk-profile** score with trend, and a Family-Council PDF that prints or emails;
- supports assessment with an **external base-rate lookup** — Claude web-search for the
  published/estimated annual probability of a risk occurring, mapped onto the family's 1–4
  Probability scale as decision support (never as an override);
- lets the user **add and change tasks in the Family Task List** directly from a risk —
  every "Required Action" in the register becomes (or links to) a real task under the
  existing `02. Risk Management` task category.

**This is not a standalone app.** It is built inside the existing `ic-app` Node/Express
project in this repo, reusing its login, sessions, database (`data/ic.db`), mailer,
Claude proxy, PDF/chart stack, and page chrome — the same way Tasks, Meetings, and
Household Expenditures were added alongside the original Due Diligence app. Read
`ic-app/README.md`, `RFO_Umbrella_TaskList_BuildSpec_v1.docx` (permission model,
umbrella structure), `RFO_Meetings_App_BuildSpec_v1.docx` (the "action item → Task List
task" link, which this app mirrors), and `RFO_Expenditure_App_BuildSpec_v1.md` (the
PDF/email report stack this app reuses) before starting.

## 2. Current State (what already exists)

Everything this module needs already exists in the umbrella — this app is almost entirely
**new tables + new module + new page**, with two small touch-points in existing code.

| Capability | Where it lives today | How Risk Management uses it |
|---|---|---|
| Auth, sessions, `requireAuth` | `server/auth.js`, `server/index.js` | Every route is `requireAuth`. |
| Per-app role columns (`dd_role`, `tasks_role`, `meetings_role`) + `is_fo_admin` | migration `012`, `server/index.js` `PUT /api/admin/members/:userId/app-role` | Add a fourth axis, `risk_role` (`admin`/`member`/`viewer`). |
| Numbered migrations | `server/migrations/`, `server/migrate.js` (applied once, tracked by filename in `schema_migrations`, idempotent guards) | New migrations start at `027` (highest today is `026_meeting_attachments.js`). |
| Module pattern | `server/tasks.js`, `server/meetings.js`, `server/expenditure.js` — each exports `register<X>Routes(app, { db, logAudit })`, mounted from `server/index.js` | New `server/risk.js` exporting `registerRiskRoutes(app, { db, logAudit })`. |
| Static page routes | `server/index.js` (`app.get('/tasks', …)` etc.) | Add `app.get('/risk', …)` → `public/risk.html`. |
| Family Task List + its `02. Risk Management` category | migration `013` (`task_categories` seed: `id: 'risk-management'`, pillar `strategy`), `server/tasks.js` (`POST /api/tasks`, `PUT /api/tasks/:id`, `task_assignees`) | Risk actions are created as `tasks` rows in category `risk-management` and linked back by id — same mechanism as `meeting_action_items.task_id`. |
| Claude proxy + web search | `server/claude.js` — `research(type, opp)` uses `tools: [{ type: 'web_search_20250305', name: 'web_search' }]`; `ClaudeNotConfiguredError` when no `ANTHROPIC_API_KEY` | Add `researchRiskProbability(...)`, same tool, same graceful-degradation contract. |
| PDF + chart export | `server/expenditure-report.js` — `pdfkit` + `chartjs-node-canvas` (both already in `package.json`, no browser), emailed via `server/mailer.js` (`sendMail({ to, subject, html, attachments })`) | New `server/risk-report.js` exporting `buildRiskReportPdf(...)`, same libraries, no new dependency. |
| Chart.js on the frontend | `public/expenditure.html` loads `https://unpkg.com/chart.js@4.5.1/dist/chart.umd.js` (within the existing `helmet` CSP `scriptSrc` allowlist — `unpkg.com` is allowed, `jsdelivr` is not) + its `ChartCanvas` React wrapper | `public/risk.html` loads the same URL and reuses the same `ChartCanvas` pattern for the heatmap and trend chart. |
| Home-page tile | `public/home.html` `GROUPS` → `strategic` group already has a **`Risk Management` tile with `comingSoon: true`** (`icon: ICONS.shield`) | Remove `comingSoon: true` and give it `href: '/risk'`. No new tile markup needed. |
| Hourly scheduler pattern | `server/digest.js`, `server/meetings-scheduler.js` (started from `server/index.js`, compare wall-clock to a cadence in `settings`) | Optional phase-2 review reminder — see §9. |
| Audit log | `server/audit.js` `logAudit({ userId, action, entityType, entityId, details })` | Log `risk.assessment_saved`, `risk.event_logged`, `risk.action_created`, `risk.taxonomy_changed`, etc. |

## 3. Naming & Umbrella Structure

- **Display name:** "Risk Management" (matches the existing home-page tile and the family's
  `02. Risk Management` task category). Eyebrow on the page: `Robinson Family Office`.
- **Route:** `/risk`. **Page:** `public/risk.html`. **Module:** `server/risk.js`.
  **API prefix:** `/api/risk/…`. **Table prefix:** `risk_…`.
- **Home page:** in `public/home.html`, the `strategic` group's `Risk Management` tile
  loses `comingSoon: true` and gains `href: '/risk'`. Leave the `Maturity Assessment`
  tile as `comingSoon`.
- **Nav chrome:** copy the `<nav class="nav">` markup and the `:root` palette
  (`--navy:#1B2A4A; --teal:#2A7D7B; --gold:#C9A84C; …`) verbatim from `public/meetings.html`
  / `public/home.html`. Same brand mark (`RFO`), same "· Sign out" control, same
  `POST /api/logout` behaviour.
- This is a **shared-dataset** app like Tasks and Meetings — one register, visible in full
  to everyone with any `risk_role`. It is **not** partitioned like Household Expenditures
  (no ledger model, no per-row visibility). `is_fo_admin` **does** imply Risk admin here,
  consistent with Tasks/Meetings/DD and unlike Expenditures.

## 4. Permission Model

Add one per-application role axis, exactly parallel to `tasks_role` / `meetings_role`
(see `RFO_Umbrella_TaskList_BuildSpec_v1.docx` §4 for the full rationale).

- **`users.risk_role`** — `admin` / `member` / `viewer`, default `viewer`. An `is_fo_admin`
  user is always also a Risk admin.
- **Backfill migration** (part of the `027` migration): add the column, then set initial
  roles from the register's own accountability language:
  - **Reg Robinson** — `admin` (Owner / Accountable on the Cover sheet). Also `is_fo_admin`
    already.
  - **Sheri-Dawn Robinson** — `admin`. Also `is_fo_admin` already.
  - **Ross Robinson** — `admin` ("Ross Robinson — Responsible for review and updates" on
    the Cover sheet; he is Accountable or co-Accountable on 6 of the 14 categories).
  - **Lucas Robinson** — `member`.
  - Any other/new account — `viewer` (the `users` table default).
- **Role capabilities:**
  | Action | viewer | member | admin |
  |---|---|---|---|
  | See the register, heatmap, profile dashboard, all reports | ✓ | ✓ | ✓ |
  | Generate / print / email a PDF report | ✓ | ✓ | ✓ |
  | Log and edit **risk events** | | ✓ | ✓ |
  | Save a **risk assessment** (P/I, status, rationale, mitigations) | | ✓ | ✓ |
  | Run an **external probability lookup** | | ✓ | ✓ |
  | Create / edit **risk actions**; promote an action to a Task List task | | ✓ (own-assigned tasks follow `tasks_role`, see §6.5) | ✓ |
  | Edit the **taxonomy** (domains, categories, scoring-scale labels) | | | ✓ |
  | Set the **review cadence / reminder** settings | | | ✓ |
- **Roles panel:** `public/risk.html` gets a "Roles" panel identical to the one in
  `public/tasks.html`, calling the existing
  `PUT /api/admin/members/:userId/app-role` with `app: 'risk'`. Add `'risk'` to that
  route's allow-list and to the `column` / `appLabel` maps in `server/index.js`
  (currently `['dd', 'tasks', 'meetings']`), and to `userPublic()` (add
  `riskAdmin` / `riskRole`, same shape as `meetingsAdmin` / `meetingsRole`).

## 5. Risk Management — Data Model

All tables in the umbrella's existing `data/ic.db`, `risk_`-prefixed, added via numbered
migrations in `server/migrations/` following the existing
`module.exports = function (db) { db.exec(...) }` pattern. Suggested split:

- `027_risk_schema.js` — the `users.risk_role` column + backfill, plus all `risk_*` tables.
- `028_risk_seed_v5.js` — seed the domains, categories, scoring scale, and the current
  (v5) assessment + mitigations + actions for all 14 categories. Keep the seed in a
  `server/risk-seed-data.js` module (mirrors `server/task-import-data.js`), and guard it
  the same way `import-tasks.js` is guarded — no-op if `risk_categories` already has rows —
  so it is safe on every boot.

### 5.1 Reference data — domains, categories, scoring scale

```
risk_domains
  id            TEXT PRIMARY KEY        -- 'A'..'F'
  name          TEXT NOT NULL           -- 'Financial Risks', ...
  sort_order    INTEGER NOT NULL

risk_categories
  id            TEXT PRIMARY KEY        -- 'risk-01' .. 'risk-14' (stable; not the display number)
  domain_id     TEXT NOT NULL REFERENCES risk_domains(id)
  number        INTEGER NOT NULL        -- 1..14, the register's display number
  title         TEXT NOT NULL           -- 'Investment & Capital Risk'
  description   TEXT NOT NULL           -- the one-line "Risk Description" from the sheet
  accountable   TEXT NOT NULL DEFAULT ''-- free text: 'Reg Robinson / Prime Quadrant'
  dalio_note    TEXT NOT NULL DEFAULT ''-- the "Dalio Framework Note" paragraph from the docx
  sort_order    INTEGER NOT NULL
  is_active     INTEGER NOT NULL DEFAULT 1  -- soft-delete; retired categories stay for history

risk_scale                              -- seeded reference, editable by admin; one source of
  kind          TEXT NOT NULL           --   truth for UI labels and the PDF. kind: 'probability'|'impact'
  score         INTEGER NOT NULL        -- 1..4
  label         TEXT NOT NULL           -- 'Unlikely'
  detail        TEXT NOT NULL           -- '5–20% probability in any given year'
  PRIMARY KEY (kind, score)
```

**Scoring rule (constant in `server/risk.js`, not a table):** `score = probability ×
impact`; band = `score <= 5 ? 'Low' : score <= 8 ? 'Medium' : 'High'`. Mirror this exactly
in `public/risk.html` and `server/risk-report.js` — one function, copied, like
`computeDecision` is mirrored between server and the DD report page.

Probability scale is **explicitly annualised**, which is what makes the external base-rate
lookup in §7 meaningful: `1 = Rare (<5%/yr)`, `2 = Unlikely (5–20%/yr)`,
`3 = Possible (20–50%/yr)`, `4 = Likely (>50%/yr)`. Impact: `1 = Minor`, `2 = Moderate`,
`3 = Significant`, `4 = Severe (existential to family wealth, health, cohesion or legacy)`.

### 5.2 `risk_assessments` — point-in-time scoring

One row per (category, assessment date). The **latest row per category is the current
state**; older rows are the history that powers the profile trend and the "what changed
since last review" diff. Never mutate a superseded assessment.

```
risk_assessments
  id                 TEXT PRIMARY KEY
  category_id         TEXT NOT NULL REFERENCES risk_categories(id)
  assessed_at         TEXT NOT NULL           -- ISO datetime
  assessed_by         TEXT NOT NULL REFERENCES users(id)
  inherent_prob       INTEGER NOT NULL        -- 1..4
  inherent_impact     INTEGER NOT NULL        -- 1..4
  residual_prob       INTEGER NOT NULL        -- 1..4
  residual_impact     INTEGER NOT NULL        -- 1..4
  status              TEXT NOT NULL           -- see enum below
  rationale           TEXT NOT NULL DEFAULT ''-- markdown; the docx "Rationale" section
  next_review         TEXT                    -- 'Q2 2027' (free text quarter, matches Task List convention)
  external_probability_id TEXT REFERENCES risk_probability_lookups(id)  -- the base-rate lookup this assessment considered, if any
  supersedes_id       TEXT REFERENCES risk_assessments(id)             -- previous assessment for this category
  note               TEXT NOT NULL DEFAULT ''-- optional "why this changed" one-liner
```

**Status enum** (from the register's `Status` column — keep the exact strings, they carry
meaning): `Active — Well Managed`, `Active — Partially Mitigated`, `In Progress`,
`INCOMPLETE — Action Required`. Store as text; render `INCOMPLETE — Action Required` in
the red treatment (see §6.1).

### 5.3 `risk_mitigations` — "Key Mitigations In Place"

Belongs to the **category**, not a single assessment (mitigations persist across reviews;
an assessment references the set that was in place at the time only implicitly, via its
`assessed_at`). Editable list.

```
risk_mitigations
  id            TEXT PRIMARY KEY
  category_id    TEXT NOT NULL REFERENCES risk_categories(id)
  text          TEXT NOT NULL
  in_place      INTEGER NOT NULL DEFAULT 1   -- 0 = planned / not yet effective
  sort_order    INTEGER NOT NULL
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL
```

### 5.4 `risk_actions` — "Required Actions", linked to the Family Task List

```
risk_actions
  id            TEXT PRIMARY KEY
  category_id    TEXT NOT NULL REFERENCES risk_categories(id)
  title         TEXT NOT NULL               -- 'Reduce fixed income below 13% IPS maximum'
  detail        TEXT NOT NULL DEFAULT ''
  priority      TEXT NOT NULL               -- 'Immediate' | 'Active' | 'Monitor'  (maps to Red/Amber/Green)
  owner_text    TEXT NOT NULL DEFAULT ''    -- 'PQ / Reg' free text (may not be an app user)
  due_quarter   TEXT                        -- 'Q3 2026'
  status        TEXT NOT NULL DEFAULT 'open'-- 'open' | 'in_progress' | 'done' | 'incomplete'
  task_id       TEXT REFERENCES tasks(id)   -- set when promoted to a Family Task List task; NULL otherwise
  created_by    TEXT NOT NULL REFERENCES users(id)
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL
```

- **`priority` ↔ the register's RAG colour:** `Immediate` = Red (`INCOMPLETE — critical
  actions outstanding`), `Active` = Amber (`identified and in progress with owner and
  timeline`), `Monitor` = Green (`in place or monitoring only`). The register's
  "Summary of Open Action Items by Priority" section (docx) maps 1:1 to these three
  buckets — reproduce that grouping in the UI and the PDF.
- **Task List link:** see §6.5. `task_id` is the single source of truth for "is this a
  real task yet." When set, the action's live status/owner/due are **read through** to the
  linked `tasks` row (join on `task_id`) so the two never drift; `risk_actions.status` is
  only authoritative while `task_id IS NULL`.

### 5.5 `risk_events` — the operational log

An **event** is something that actually happened and bears on a risk category: a phishing
attempt, a manager suspending redemptions, a health incident, a break-in, a tax
reassessment, a near-miss. Distinct from an assessment (a judgement) and an action (a
to-do). This is the "manage risk events within the categories" requirement.

```
risk_events
  id                  TEXT PRIMARY KEY
  category_id          TEXT NOT NULL REFERENCES risk_categories(id)
  occurred_on          TEXT NOT NULL          -- date
  title                TEXT NOT NULL
  description          TEXT NOT NULL DEFAULT ''
  severity             TEXT NOT NULL          -- 'Near miss' | 'Minor' | 'Moderate' | 'Significant' | 'Severe'
  financial_impact_cad REAL                   -- nullable; realised or best-estimate loss/cost
  status               TEXT NOT NULL DEFAULT 'open'  -- 'open' | 'monitoring' | 'closed'
  response_notes       TEXT NOT NULL DEFAULT ''
  logged_by            TEXT NOT NULL REFERENCES users(id)
  created_at           TEXT NOT NULL
  updated_at           TEXT NOT NULL
  closed_at            TEXT
```

- An event may **spawn an action** (button: "Create action from this event" → new
  `risk_actions` row in the same category, prefilled) and/or **prompt a re-assessment**
  (button: "Reassess this risk" → opens the §6.2 assessment form for the category). Track
  the spawned action via the action's own `detail`/audit, not a hard FK — keep the events
  table narrow.
- Events feed the profile dashboard (§6.4): count and summed `financial_impact_cad` by
  category and by quarter, and an "events in the last 12 months" figure per category shown
  next to its score as corroboration (or contradiction) of the assessed Probability.

### 5.6 `risk_probability_lookups` — external base-rate research cache

```
risk_probability_lookups
  id                 TEXT PRIMARY KEY
  category_id         TEXT REFERENCES risk_categories(id)  -- nullable: ad-hoc lookups allowed
  query               TEXT NOT NULL          -- the phrasing sent to Claude
  estimate_text       TEXT NOT NULL          -- Claude's plain-English answer
  probability_low      REAL                  -- annual probability band, e.g. 0.05
  probability_high     REAL                  -- e.g. 0.20
  mapped_score        INTEGER                -- 1..4 on the family's scale, Claude's suggested mapping
  rationale           TEXT NOT NULL DEFAULT ''
  sources             TEXT NOT NULL DEFAULT '[]'  -- JSON array of {title, url}
  model               TEXT NOT NULL
  searched_by         TEXT NOT NULL REFERENCES users(id)
  searched_at         TEXT NOT NULL
```

Log token usage via `logApiUsage` exactly as `server/claude.js` callers already do.

### 5.7 Seed data (v5) and reconciliation notes

Seed `028_risk_seed_v5.js` from the two source files, transcribed into
`server/risk-seed-data.js`. **The `RFO_Risk_Register_Notes_v5.docx` domain structure is
authoritative** where the two disagree:

- **6 domains, 14 categories.** Domains: `A` Financial, `B` Family Relationships,
  `C` Family Health & Safety, `D` External Events, `E` Operational & Governance,
  `F` Investment Execution.
- The spreadsheet's own row numbering is inconsistent (two rows numbered "9"; Monetary
  Hedge appears as row 2 in the sheet but as Risk 14 in the notes). **Use the notes'
  numbering** (Monetary Hedge & Direct Investment = Risk 14, Domain F). Fix the duplicate
  "9" when transcribing — Cognitive & Capacity Decline = 8, Death / Early Death = 9. Do
  not carry the spreadsheet's numbering glitches forward.
- Where the spreadsheet and notes give slightly different residual scores or mitigation
  wording, prefer the **notes** (they are the longer-form, later-reviewed version) and
  leave a `-- SOURCE DISCREPANCY:` comment in the seed file at each such row so the first
  human review can confirm.

**Reconciled seed table** (Domain · # · Title · Inherent P×I=Score · Residual P×I=Score ·
Status · Accountable). Scores are computed, shown here for transcription checking:

| Dom | # | Title | Inherent | Residual | Status | Accountable |
|---|---|---|---|---|---|---|
| A | 1 | Investment & Capital Risk | 3×4=12 High | 2×3=6 Med | Active — Well Managed | Reg Robinson / Prime Quadrant |
| A | 2 | Foreign Exchange Risk | 2×2=4 Low | 2×2=4 Low | Active — Partially Mitigated | PQ / Reg Robinson |
| A | 3 | Legal & Regulatory Risk | 3×3=9 High | 2×2=4 Low | Active — Partially Mitigated | Reg Robinson / EY |
| B | 4 | Family Relationships Risk | 2×4=8 Med | 1×3=3 Low | Active — Well Managed | Reg Robinson / Sheri-Dawn Robinson |
| B | 5 | Next Generation Readiness Risk | 2×4=8 Med | 2×3=6 Med | Active — Partially Mitigated | Reg Robinson / Ross Robinson |
| C | 6 | Personal Health Risk | 3×3=9 High | 2×2=4 Low | Active — Well Managed | All family members / Reg & Sheri-Dawn |
| C | 7 | Personal Safety Risk | 2×3=6 Med | 2×2=4 Low | Active — Partially Mitigated | Ross Robinson / All family members |
| C | 8 | Cognitive & Capacity Decline Risk | 2×4=8 Med | 1×3=3 Low | Active — Partially Mitigated | Reg Robinson / MLTA / Ross Robinson |
| C | 9 | Death / Early Death Risk | 2×4=8 Med | 1×3=3 Low | INCOMPLETE — Action Required | Reg Robinson / MLTA |
| D | 10 | External Events Risk | 2×3=6 Med | 2×2=4 Low | Active — Well Managed | Reg Robinson / Prime Quadrant |
| E | 11 | Cyber Security Risk | 3×3=9 High | 2×3=6 Med | In Progress | Ross Robinson |
| E | 12 | Key Advisor Dependency Risk | 2×3=6 Med | 2×2=4 Low | Active — Partially Mitigated | Reg Robinson / Ross Robinson |
| E | 13 | Reputational & Privacy Risk | 2×3=6 Med | 1×3=3 Low | Active — Partially Mitigated | Sheri-Dawn Robinson / Reg Robinson |
| F | 14 | Monetary Hedge & Direct Investment Risk | 2×2=4 Low | 2×2=4 Low | Active — Partially Mitigated | Ross Robinson (Monetary Hedge lead) / Reg Robinson (Watch Collection owner) |

For each category, seed: the one-line `description` and `dalio_note` from the docx; every
"Mitigations In Place" bullet as a `risk_mitigations` row (`in_place = 1`); every "Open
Action Item" as a `risk_actions` row with `priority` derived from the docx "Summary of
Open Action Items by Priority" section (`Immediate Action Required` → `Immediate`,
`Active Management` → `Active`, `Monitor` → `Monitor`; anything only in a category's list
and not in the summary → `Active`) and `status = 'incomplete'` for the items the docx
prefixes `INCOMPLETE —`, else `'open'`. Seed one `risk_assessments` row per category with
`assessed_at` = the register effective date (`2026-06-01`), `assessed_by` = Reg's user id,
`next_review` from the docx "Next Review" line, and `supersedes_id = NULL`.

Also seed the **IPS asset-allocation context** the notes lean on (8 classes, Monetary
Hedge target 3% / max 5%) as static reference content on the page — it is background for
Risks 1, 2, 10, and 14, not register data. Put it in `server/risk-seed-data.js` as a
plain constant the page renders in an "IPS context" disclosure; do not model it as tables.

## 6. Risk Management — Screens & Interactions

Single-page React app (`public/risk.html`), same build-free pattern as the other four
pages: `React.createElement` aliased to `h`, one inline `<script>`, no JSX, no bundler.
Tabs across the top: **Register** · **Profile** · **Events** · **Actions & Tasks** ·
(admin only) **Manage**.

### 6.1 Register view (all roles)

- The 14 categories grouped by domain (A–F), each domain a collapsible section with a
  domain-level residual-score summary (see §6.4).
- Per row: number, title, one-line description, **Inherent** chip (`P×I = score`,
  Low/Med/High colour), **Residual** chip, Status pill, Accountable, `Next review`, a
  count of **open actions** (with the Immediate count in red if > 0), and a count of
  **risk events in the last 12 months**.
- Colour: Low `#1E9E5A` on `#E8F8EF`, Medium `#B45309` on `#FDF6E3`, High `#9D174D` on a
  light rose. Status `INCOMPLETE — Action Required` always rendered in the High/red
  treatment regardless of score.
- Toggle: **Residual (default) / Inherent** — swaps which score every chip and the
  heatmap show.
- Filters: domain, status, residual band, accountable (substring), "review due this
  quarter or overdue", "has open Immediate action". Filters also constrain the PDF export
  (§8), same as the Expenditure app's filter→report contract.
- Click a row → the **Risk detail** drawer (§6.2).

### 6.2 Risk detail & assessment (drawer; save requires member/admin)

Read-only for viewers; editable for member/admin.

- **Header:** number, title, domain, current Residual and Inherent chips, Status pill.
- **Rationale** (markdown, rendered), **Dalio Framework Note**, **Accountable**,
  **Next review**.
- **Mitigations In Place** — editable list (`risk_mitigations`): add / edit / reorder /
  toggle `in_place` / remove.
- **Required Actions** — the category's `risk_actions` (see §6.5 for the Task List link).
- **Events** — the category's `risk_events`, newest first, with "Log event" (§6.3).
- **Assessment history** — every `risk_assessments` row for this category, oldest→newest,
  each showing the P/I → score for inherent and residual, who assessed it, and the
  `note`. A sparkline of residual score over time.
- **"New assessment"** (member/admin) — a form pre-filled from the latest assessment:
  four 1–4 selectors (inherent P, inherent I, residual P, residual I) each showing the
  `risk_scale` label+detail for the chosen value; Status select; Rationale (markdown);
  Next review (quarter). Beside the **residual Probability** selector: a **"Look up base
  rate"** button (§7) that, when a lookup returns, shows Claude's estimated annual
  probability, its suggested 1–4 mapping, and its sources inline — the assessor still
  picks the number; the chosen `external_probability_id` is stored on the assessment for
  audit. Saving writes a new `risk_assessments` row with `supersedes_id` = the previous
  latest, and `logAudit('risk.assessment_saved')`.

### 6.3 Events tab / "Log event" (member/admin)

- A flat, filterable table of all `risk_events` across categories: date, category, title,
  severity, financial impact (CAD), status, logged-by.
- Filters: category, domain, severity, status, date range.
- "Log event" form: category (required), date, title, description, severity, optional
  financial impact, status, response notes. On save: `logAudit('risk.event_logged')`.
- Row actions: edit; **"Create action from event"** (→ prefilled `risk_actions` form in
  that category); **"Reassess this risk"** (→ §6.2 new-assessment form); close (sets
  `status = 'closed'`, `closed_at`).

### 6.4 Profile tab — overall risk profile (all roles)

- **4×4 heatmap** (Probability 1–4 on one axis, Impact 1–4 on the other), each cell tinted
  Low/Med/High by `P×I`. Every category is a dot in its cell at the current
  **residual** score (toggle to inherent). Dots in the same cell fan out; hover shows the
  title; click opens the detail drawer. Build with Chart.js `scatter` (integer axes) or a
  hand-drawn CSS grid — either is fine; the Expenditure app's `ChartCanvas` wrapper is
  the reference if using Chart.js.
- **Profile summary cards:**
  - counts of categories in Low / Medium / High residual bands (and the same for
    inherent, for contrast);
  - **aggregate residual exposure** = sum of residual scores across active categories
    (v5 baseline = 58), shown against the inherent sum (v5 baseline = 103) so the
    mitigation effect is visible as one number;
  - count of `INCOMPLETE — Action Required` categories and of open **Immediate** actions;
  - risk events in the last 12 months (count and summed CAD impact);
  - **most-improved / most-deteriorated** category since the previous assessment round.
- **Trend chart** — aggregate residual exposure over time, one point per assessment date
  (line). Because assessments are snapshotted per category, compute each historical point
  as "sum over categories of the residual score from that category's latest assessment
  at-or-before date X."
- **Domain rollup** — a small bar per domain: mean residual score and worst residual
  score, with the domain's open-action count.
- **"Changes since last review"** — pick two dates (default: latest round vs. the one
  before); table of every category whose residual score, status, or open-action count
  changed, with before → after.

### 6.5 Actions & Tasks tab — Family Task List integration (explicit requirement)

This is the "add and change tasks in the RFO task list" surface. It works **through the
existing Task List API and data** — no parallel task store.

- **Two panels on one screen:**
  1. **Risk actions** — every `risk_actions` row, grouped by the Immediate / Active /
     Monitor priority buckets (the register's RAG grouping), each showing its category,
     owner text, due quarter, and — if `task_id` is set — the linked task's live title,
     assignees, priority, target, and status (joined from `tasks` / `task_assignees`).
  2. **Task List — Risk Management category** — a live view of every `tasks` row in
     category `risk-management` (via `GET /api/tasks`, filtered client-side to
     `categoryId === 'risk-management'`), including tasks created here and any added
     directly in `/tasks`. Inline create/edit/complete, calling the **existing**
     `POST /api/tasks` / `PUT /api/tasks/:id` endpoints unchanged. Write access follows
     `tasks_role` (a Risk admin who is only a Tasks `viewer` sees the panel read-only and
     is told why) — this keeps one permission model for task mutation.
- **Promote an action to a task:** button on any `risk_actions` row with `task_id IS NULL`.
  Opens a small form defaulting: `title` = action title, `categoryId` = `risk-management`,
  `priority` = `high` if action priority is `Immediate` else `medium`, `targetQuarter` =
  the action's `due_quarter`, `notes` = a back-reference (`"From Risk #N — <category
  title>"` plus the action detail), assignees = none (assign in the form). On submit:
  `POST /api/tasks`, then `PUT /api/risk/actions/:id` to store the returned `task_id`.
  `logAudit('risk.action_promoted_to_task', { taskId })`. This mirrors
  `meeting_action_items` → `tasks` in `server/meetings.js` — reuse that code path's shape.
- **After linking:** the action's status/owner/target are shown read-through from the
  task. Completing the task (in either panel, or in `/tasks`, or via the digest's Google
  Tasks sync) makes the action render as done. "Unlink" clears `task_id` (leaves the task
  alone) and restores `risk_actions.status` as authoritative. Deleting the task in
  `/tasks` leaves `task_id` dangling → the join returns null → the action falls back to
  its own `status` and shows a "linked task was deleted" hint.
- **No new task schema.** The only optional convenience: a nullable
  `tasks.source_ref_id` already exists (used by the one-off import); do **not** repurpose
  it. The link is held on the risk side (`risk_actions.task_id`), exactly as
  `meeting_action_items.task_id` holds it on the meetings side.

### 6.6 Manage tab (admin only)

- **Taxonomy editor:** rename domains; add / rename / retire (`is_active = 0`) categories;
  edit a category's description, accountable text, and Dalio note; reorder. Retiring a
  category hides it from the register but keeps its assessments/events/actions for history
  and the trend. Adding a category requires domain + title + description; it enters the
  register with no assessment until someone runs one (shows as "Not yet assessed").
- **Scoring-scale editor:** edit the `risk_scale` labels/details (e.g. re-word an impact
  band). The `score = P×I` and band cutoffs (5 / 8) are **not** user-editable — they are
  the constant in code; note this in the UI.
- **Roles panel:** as in `/tasks` (§4).
- **Review cadence:** the settings for the optional reminder (§9).

## 7. External Probability Research (Claude web search)

Add to `server/claude.js`, following `research(type, opp)` exactly (same
`web_search_20250305` tool, same `extractJson`, same `ClaudeNotConfiguredError` /
"not configured" degradation, same `logApiUsage` by the caller):

```js
// Estimates the base rate — published or reasoned annual probability — that a given risk
// category materialises for a Canadian family office, and maps it onto the family's 1–4
// annualised Probability scale. Decision support for a risk assessment (see
// RFO_Risk_App_BuildSpec_v1.md §6.2) — the assessor still picks the score.
async function researchRiskProbability({ title, description, context }) {
  // system: "You are helping a Canadian family office (Robinson Family Office, Ontario,
  //   ~CAD $30M AUM, 6 family members across three couples) estimate how often a specific
  //   risk tends to occur, for an enterprise risk register. Search the web for actuarial
  //   data, insurer statistics, regulator/industry reports, and credible studies. Prefer
  //   figures expressed as an annual probability or frequency. Be explicit about
  //   uncertainty and about how well the external data fits this family's situation.
  //   Today is <date>."
  // user: "<title> — <description>. Additional context: <context>.
  //   Return ONLY valid JSON, no markdown:
  //   {"estimateText":"2-4 plain-English sentences a non-expert can follow",
  //    "probabilityLow":0.05,"probabilityHigh":0.20,   // annual, decimals; null if truly not estimable
  //    "mappedScore":2,   // 1=<5%/yr, 2=5-20%, 3=20-50%, 4=>50%/yr — pick the band probabilityLow..High mostly falls in
  //    "rationale":"one sentence on why this score, incl. any adjustment for the family's specifics",
  //    "sources":[{"title":"...","url":"..."}],   // the 2-4 most load-bearing
  //    "caveats":"one sentence on what the external data does NOT capture"}"
  // tools: [{ type: 'web_search_20250305', name: 'web_search' }], max_tokens ~3000
}
```

Route: `POST /api/risk/probability-lookup` (member/admin) — body `{ categoryId? , title,
description, context? }`; on success persists a `risk_probability_lookups` row and returns
it; on `ClaudeNotConfiguredError` returns `{ configured: false }` and the UI shows the
manual-only state (same as the DD research fields).

**Framing in the UI (important):** present the result as "external base rate", shown next
to — never replacing — the assessor's Probability selector. Store both the external
estimate (`external_probability_id` on the assessment) and the human-chosen
`residual_prob` / `inherent_prob`. Categories where an external base rate is largely
meaningless (family relationships, next-gen readiness, cognitive decline of a specific
person) should still allow the lookup but the prompt's `caveats` will — correctly — say
the external data doesn't capture the family's specifics; that is a feature, not a bug.
Cache/display the last lookup per category with its `searched_at` so it isn't re-run
casually (each call costs a few cents and some seconds).

## 8. Reporting & Export

- **On-screen:** the Register (§6.1) and Profile (§6.4) tabs are the primary report.
- **PDF** — new `server/risk-report.js` exporting
  `async function buildRiskReportPdf({ filters, asOf })`, using `pdfkit` +
  `chartjs-node-canvas` (both already dependencies; **no new package**), pattern-for-pattern
  with `server/expenditure-report.js`:
  - Cover: "Robinson Family Office — Enterprise Risk Register", generated date, applied
    filters, the aggregate residual vs. inherent exposure numbers.
  - The 4×4 heatmap as a rendered PNG (`chartjs-node-canvas`, `scatter`, integer axes,
    `backgroundColour: 'white'`).
  - The register table grouped by domain (number, title, inherent, residual, status,
    accountable, next review) — respecting the caller's filters.
  - Open actions grouped Immediate / Active / Monitor, each with owner and due quarter,
    and a marker for those linked to a live Task List task.
  - Risk events in the reporting window (or last 12 months if unfiltered).
  - "Changes since last review" table if a comparison date is supplied.
- **Routes:** `GET /api/risk/report/pdf?…filters…` (streams the PDF, `Content-Type:
  application/pdf`) and `POST /api/risk/report/email` (`{ to: [...], subject?, filters }`
  → `mailer.sendMail({ to, subject, html, attachments: [{ … base64 … }] })`, reusing
  `email-template.js`'s `emailShell` / `contentRow` / `paragraph`). Both available to all
  roles. "Print" in the UI = open the PDF route in a new tab; "Email as PDF" = a small
  recipient form → the email route. Same two actions the Expenditure reports expose.

## 9. Scheduled Review Reminders (optional — phase 2)

Mirror `server/digest.js` / `server/meetings-scheduler.js`: an hourly sweep started from
`server/index.js` that, on a cadence stored in `settings`
(`risk_review_cadence`, `risk_review_day_of_week`, `risk_review_hour`, `risk_review_tz`,
`risk_review_enabled`), emails the Risk admins a digest of: categories whose `next_review`
quarter has arrived or passed with no newer assessment; `INCOMPLETE — Action Required`
categories; open **Immediate** actions past their `due_quarter`; and risk events still
`open` after 30 days. Same Microsoft Graph mailer, same `email-template.js` shell. Ship
§§1–8 first; this is additive and touches no schema beyond `settings` keys.

## 10. Implementation Checklist (file-by-file)

### 10.1 New migrations (`ic-app/server/migrations/`)

- **`027_risk_schema.js`** — `ALTER TABLE users ADD COLUMN risk_role TEXT NOT NULL DEFAULT
  'viewer'` (guard with a `PRAGMA table_info(users)` existence check, same as `012` does
  for its columns); backfill Reg/Sheri-Dawn/Ross → `admin`, Lucas → `member`; create
  `risk_domains`, `risk_categories`, `risk_scale`, `risk_assessments`,
  `risk_mitigations`, `risk_actions`, `risk_events`, `risk_probability_lookups` with
  `CREATE TABLE IF NOT EXISTS`.
- **`028_risk_seed_v5.js`** — require `../risk-seed-data.js`; no-op if
  `SELECT COUNT(*) FROM risk_categories` > 0; else insert domains, categories, scale,
  mitigations, actions, and one baseline assessment per category (§5.7).

### 10.2 Server changes

- **`server/risk-seed-data.js`** (new) — the reconciled v5 content (domains, 14 categories
  with descriptions + Dalio notes, scale labels, per-category mitigation bullets and
  action items with priority/status, baseline P/I/status/next-review), plus the IPS
  context constant. Transcription target for the two source docs; keep
  `-- SOURCE DISCREPANCY:` comments where the sheet and notes differ.
- **`server/risk.js`** (new) — `registerRiskRoutes(app, { db, logAudit })`. Routes, all
  `requireAuth`, role-checked via a local `myRoles(userId)` helper reading
  `is_fo_admin` + `risk_role` (copy `server/tasks.js`'s `myRoles`):
  - `GET /api/risk/overview` — domains, categories each with their latest assessment,
    open-action counts, 12-month event counts (the Register payload).
  - `GET /api/risk/categories/:id` — full detail: all assessments, mitigations, actions
    (with linked-task join), events.
  - `POST/PUT/DELETE /api/risk/categories` and `…/domains` and `…/scale` — admin only
    (Manage tab).
  - `POST /api/risk/categories/:id/assessments` — member/admin; writes a new assessment,
    sets `supersedes_id`.
  - `POST/PUT/DELETE /api/risk/categories/:id/mitigations` — member/admin.
  - `GET /api/risk/actions`, `POST/PUT/DELETE /api/risk/actions[/:id]` — member/admin;
    `POST /api/risk/actions/:id/promote` creates the `tasks` row (calls the same
    insert logic `server/tasks.js` uses — factor a shared helper or duplicate the small
    INSERT) and stores `task_id`; `POST /api/risk/actions/:id/unlink` clears it.
  - `GET /api/risk/events`, `POST/PUT /api/risk/events[/:id]`,
    `POST /api/risk/events/:id/close` — member/admin.
  - `POST /api/risk/probability-lookup` — member/admin; §7.
  - `GET /api/risk/profile` — heatmap points, band counts, aggregate exposure (current +
    historical series), domain rollup, since-last-review diff.
  - `GET /api/risk/report/pdf`, `POST /api/risk/report/email` — all roles; §8.
- **`server/risk-report.js`** (new) — `buildRiskReportPdf({ filters, asOf, compareTo })`,
  copy the structure of `server/expenditure-report.js` (its `chartCanvas`,
  `renderToBuffer`, `fmtCAD`, page/table helpers).
- **`server/claude.js`** — add `researchRiskProbability(...)` (§7); add it to
  `module.exports`.
- **`server/index.js`** —
  - `const registerRiskRoutes = require('./risk');` and
    `registerRiskRoutes(app, { db, logAudit });` next to the other `register…Routes` calls
    (~line 1355).
  - `app.get('/risk', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'risk.html')));`
    next to the other page routes (~line 1371).
  - In `PUT /api/admin/members/:userId/app-role`: add `'risk'` to the `app` allow-list,
    the `column` map (`risk_role`), and the `appLabel` map (`Risk Management`).
  - In `userPublic(row)`: add `riskAdmin: isFoAdmin || row.risk_role === 'admin'` and
    `riskRole: row.risk_role`.
  - Optional (§9): `const { startRiskReviewScheduler } = require('./risk-scheduler');`
    and start it alongside `startDigestScheduler()` / `startMeetingsScheduler()`.
- **`server/risk-scheduler.js`** (new, optional/phase 2) — §9.
- **Tests** (`node --test`, matching `server/*.test.js`): `score`/band function;
  latest-assessment-per-category selection; aggregate-exposure historical series;
  action↔task link read-through and unlink fallback; `researchRiskProbability` JSON
  parsing incl. `stop_reason === 'max_tokens'` and the not-configured path.

### 10.3 Frontend changes

- **`public/risk.html`** (new) — React 18 + `chart.js@4.5.1` from `unpkg.com` (three
  `<script src>` tags, copy from `public/expenditure.html` lines 7–9); nav chrome + `:root`
  palette copied from `public/meetings.html`; tabs Register / Profile / Events / Actions &
  Tasks / Manage; the `ChartCanvas` wrapper copied from `public/expenditure.html`. Fetch
  helper with the `credentials: 'same-origin'` + 401-redirect-to-`/due-diligence` pattern
  used by every other page. Gate write UI on `me.riskAdmin` / `me.riskRole`; gate the
  Task List panel's writes on `me.tasksRole` / `me.tasksAdmin`.
- **`public/home.html`** — in `GROUPS` → `strategic` → the `Risk Management` tile: delete
  `comingSoon: true`, add `href: '/risk'`. Nothing else.

### 10.4 README / docs

- `ic-app/README.md`:
  - Add "Risk Management (`/risk`)" to the umbrella app list at the top.
  - Add the `risk_*` tables and `users.risk_role` to the Data model section.
  - Note the new `risk_role` axis in Permissions (four per-app roles now: `dd_role`,
    `tasks_role`, `meetings_role`, `risk_role`).
  - If §9 ships, add a "Scheduled risk-review reminder" note next to the Task List digest
    and Meetings scheduler notes.
- This file (`RFO_Risk_App_BuildSpec_v1.md`) is the full spec; keep it beside the other
  `RFO_*_BuildSpec` docs in the repo root.

## 11. Suggested Build Order

1. **Schema + roles:** `027_risk_schema.js` (tables + `risk_role` + backfill) and the
   `server/index.js` role wiring (`app-role` route, `userPublic`). Confirm the existing
   `node --test` suite still passes.
2. **Seed:** `server/risk-seed-data.js` + `028_risk_seed_v5.js`. Transcribe both source
   docs; eyeball the seeded register against the reconciled table in §5.7 and against the
   docx. This is the step to get right — everything else renders it.
3. **Register + detail read path:** `GET /api/risk/overview`, `GET
   /api/risk/categories/:id`, and the Register tab + read-only detail drawer. Verify it
   reproduces the v5 register.
4. **Assessments:** the new-assessment form, `POST …/assessments`, assessment history +
   sparkline. Run a second assessment on one category and confirm history/supersede.
5. **Mitigations + Actions (without the Task List link yet):** editable lists.
6. **Task List integration (§6.5):** the Actions & Tasks tab, `promote` / `unlink`, the
   read-through join, the live `risk-management` task panel using the existing task API.
   Test create-from-risk, complete-in-`/tasks`-reflects-in-risk, delete-task fallback.
7. **Events (§6.3):** Events tab, log/edit/close, "create action from event",
   "reassess this risk".
8. **Profile dashboard (§6.4):** heatmap, summary cards, trend, domain rollup, changes-
   since-last-review. `GET /api/risk/profile`.
9. **External probability lookup (§7):** `researchRiskProbability`, the route, the inline
   UI beside the residual-Probability selector. Test the not-configured path.
10. **PDF + email report (§8):** `server/risk-report.js`, the two routes, Print / Email
    actions.
11. **Home tile + README.**
12. **(Phase 2) Review reminder scheduler (§9).**

Check in real output at steps 2, 3, and 8 (the seeded register, the reproduced grid, the
profile numbers) rather than building straight through — the whole point of the app is
that these match the family's reviewed v5 position.

## 12. Decided (no longer open)

- **Not a standalone app** — a fifth module inside `ic-app`, same stack (Node/Express,
  `node:sqlite`, React-via-CDN, `pdfkit` + `chartjs-node-canvas`), same login/DB/mailer.
- **Shared dataset**, not ledger-partitioned. One register, visible to every role;
  `is_fo_admin` implies Risk admin. Fourth per-app role axis `risk_role`
  (`admin`/`member`/`viewer`), parallel to `tasks_role`.
- **Taxonomy = 6 domains, 14 categories**, seeded from v5 with the
  `RFO_Risk_Register_Notes_v5.docx` structure authoritative over the spreadsheet where
  they disagree; spreadsheet numbering glitches (duplicate "9") fixed on transcription.
- **Scoring:** `P×I`, bands 1–5 Low / 6–8 Medium / 9–16 High, inherent vs. residual —
  fixed in code; only the 1–4 scale *labels* are admin-editable.
- **Assessments are immutable snapshots** (`risk_assessments`, `supersedes_id` chain);
  latest per category = current state; the chain powers the profile trend and the
  since-last-review diff.
- **Risk events** are a first-class operational log (`risk_events`), distinct from
  assessments and actions.
- **Task List integration goes through the existing Task List** — `risk_actions.task_id`
  links to a real `tasks` row in the existing `risk-management` category, exactly like
  `meeting_action_items.task_id`; no parallel task store; task mutation stays under
  `tasks_role`.
- **External probability lookup** is Claude web-search (`researchRiskProbability` in
  `server/claude.js`, same contract as `research`), presented as decision-support base
  rate beside the assessor's own score, never replacing it; degrades to manual when
  `ANTHROPIC_API_KEY` is unset.
- **Reports** reuse the Expenditure app's `pdfkit` + `chartjs-node-canvas` + Graph-mailer
  stack — no new dependency.

## 13. Still open — confirm before/while building

1. **Initial `risk_role` for Lucas** — `member` (can log events and run assessments) or
   `viewer` (read-only)? Spec assumes `member`.
2. **Who can edit the taxonomy** — spec restricts add/retire-category and scale-label
   edits to Risk admin. Confirm Ross (admin) editing the category set is intended, or
   whether taxonomy changes should be FO-admin-only.
3. **External lookup scope** — run it for all 14 categories (accepting that relationship /
   next-gen / cognitive categories will return low-confidence, caveat-heavy answers), or
   hide the button for the Domain B / C "person-specific" categories? Spec allows it
   everywhere.
4. **Two-way action/task status sync depth** — spec makes the linked `tasks` row
   authoritative once linked (action reads through). Confirm that's preferred over a
   looser "link but keep separate statuses" model.
5. **Phase-2 review reminder (§9)** — wanted now, or genuinely deferred? It needs only
   `settings` keys, no schema.
6. **`risk_events` financial impact** — single CAD figure (spec) is enough, or is a
   realised-vs-estimated split wanted from the start?
7. **Retention of the source spreadsheet** — once seeded and reviewed in-app, is
   `RFO_Risk_Register_v5.xlsx` retired, or kept in sync manually for a transition period?
