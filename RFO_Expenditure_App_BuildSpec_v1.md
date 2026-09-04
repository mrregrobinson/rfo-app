# RFO Household Expenditure Reporting — Build Instructions

## Objective

Add a fourth module to the RFO umbrella app (`ic-app/`, alongside PQ Introduced Due Diligence, Family Task List, and Family Office Meetings) that tracks household expenditures for Reg and Sheri-Dawn, sourced from bank and credit card statements, to support family office planning (investment planning, retreats, vacations, budgeting).

**This is not a standalone app.** It gets built inside the existing `ic-app` Node/Express project in this repo, reusing its login, sessions, database, and mailer — the same way Tasks and Meetings were added alongside the original Due Diligence app. See `ic-app/README.md` for the umbrella's current architecture before starting.

## The actual source data (confirmed by inspection, not assumed)

The real input files live in `Family Office/Financial/2026/Expenditure calc/`: five zip files (`2022-07 to 2022-12.zip` … `2026-01 to 2026-08.zip`) spanning mid-2022 through August 2026, each containing individual PDF statements. Copy that folder's contents somewhere the app can read them for the initial backfill (e.g. a temp upload), or ingest them via the same upload UI real users will use going forward — don't wire up a one-off path that only works for this historical import.

There are **three recurring accounts**, all Royal Bank of Canada (RBC) Private Banking:

| Account | File name pattern | Statement layout |
|---|---|---|
| CAD Chequing (…0344) | `R&S CAD Chequing 5000344 Statement-0344 <date>.pdf` | Date / Description / Withdrawals($) / Deposits($) / Balance($) table, "Details of your account activity", continues across pages |
| USD Chequing (…0435) | `R&S USD Chequing 4500435 Statement-0435 <date>.pdf` | Same layout as CAD chequing, in USD — **low volume**, a handful of transactions per statement |
| RBC Avion Visa Infinite Privilege (…8369), joint card with Reg (primary) and Sheri-Dawn (…6828) | `4646-9236-0080-8369 (R&S Priv) Statement-8369 <date>.pdf` | Transaction Date / Posting Date / Activity Description / Amount($) table, grouped by cardholder, paginated ("1 OF 9" etc.) |

Some zips contain overlapping statement dates (duplicate filenames with a ` (1)` suffix) — **the ingestion pipeline must dedupe by statement content (account + statement period), not by filename**, since the same statement may appear in more than one zip or be re-uploaded later.

**Statements will keep arriving as either zips or individual PDFs** — the upload UI must accept both, unzipping server-side when a `.zip` is given.

## PDF extraction: use Claude, the same way `server/claude.js` already does

Plain-text extraction (`pdftotext -layout`, or a naive PDF text-parsing library) **interleaves the transaction table with sidebar content** (RBC promotional text, Avion points balance, interest rates, payment due date) because these statements are laid out in two visual columns. A position/coordinate-based table parser could be built to work around this, but the umbrella app already has a proven, working solution to exactly this class of problem: `server/claude.js`'s `extractPdf` / `extractPortfolioReport` / `extractIncomeReport` send the whole PDF to Claude as a base64 `document` content block and get back structured JSON — Claude reads the layout visually rather than depending on text order, so the column-interleaving issue doesn't arise.

Follow that same pattern: add an `extractStatement(base64Data, accountType)` function to `server/claude.js` that:
- Sends the full statement PDF (all pages) to Claude in one call.
- Asks for every transaction as `{date, postDate (cards only), description, amount, runningBalance (chequing only, when shown)}`, plus the statement's own summary numbers (chequing: opening balance, closing balance, total deposits, total withdrawals; card: previous balance, payments & credits, purchases & debits, interest, fees, new balance).
- Uses those summary numbers for a **reconciliation check** after parsing: sum of extracted transactions should match the statement's own stated totals. Flag (don't silently accept) any statement that fails to reconcile, the same way a reviewer would want to know if a PQ report extraction looked off.
- Sizes `max_tokens` generously (the Visa statement alone can run 9 pages) — follow `extractPortfolioReport`'s precedent (16000) rather than `extractPdf`'s (3000), and watch for the `stop_reason === 'max_tokens'` truncation case already handled in `extractJson`.

This reuses the `ANTHROPIC_API_KEY` already configured for the umbrella and costs a small amount per statement (existing README notes "roughly a few cents" per PDF extraction call for shorter documents; budget a bit more per call here given these run longer — still a few dollars, one-time, to backfill ~4 years of history across three accounts). No new PDF-parsing dependency needed.

Other real quirks the extraction prompt should account for, observed directly in the statements:
- Chequing statements sometimes show a transaction with **no date** (a continuation of the prior row's date) and sometimes split description across two lines (e.g. an e-Transfer description line followed by a reference-code line).
- Credit card amounts can be negative (`-$15,000.00`), representing payments/credits rather than purchases.

## Transfer / non-expenditure detection

Based on the real transaction descriptions seen in these statements, treat the following as **transfers or non-expenditure items to exclude from household spending**, and flag/tag them distinctly rather than dropping them silently — keep them in the DB tagged `is_transfer`, so the data stays auditable:

- `e-Transfer sent …`, `Online Banking transfer …`, `Account transfer …` between the household's own accounts
- `Funds transfer credit/fee …` (e.g. TT ICAPITAL) and `Investment …` postings (e.g. TREZ CAPITAL) — capital movements, not spending
- Credit card **payments** appearing as large negative amounts on the Visa statement, and the matching `Online Banking payment - ####` withdrawal on the chequing statement that funds it — these two must not both be excluded blindly; the actual purchases behind the card payment already appear as line items on the Visa statement, so excluding just the payment/transfer (both sides) avoids double counting
- `Deposit interest` / `Interest …` credited to chequing, and any other income items — **income is out of scope entirely for this app.** Exclude it from ingestion/reporting the same way transfers are excluded; there is no "income view" to build here, now or later.
- `Property Tax CityOf Waterloo` — a genuine recurring household cost, **do not** treat as a transfer; categorize it (e.g. "Housing/Property Tax")

Because payee names for e-Transfers vary (Red Bear Landscaping, Dobson Yard Care, Collyers Construction, Jodi Kingdon, etc.), don't hardcode a transfer rule on payee name for e-Transfers paying real vendors for real services — those are legitimate expenditures, not transfers, even though they arrive via e-Transfer. Key the transfer/exclusion rule off the **transaction type/description prefix** (e-Transfer *between the household's own named accounts*, internal "Account transfer", "Online Banking transfer") rather than assuming all e-Transfers are internal. Where the statement doesn't make the distinction unambiguous, err toward keeping the item as a categorized expenditure (e.g. "Miscellaneous") rather than silently excluding real spending — false exclusion is worse than a miscategorization, since it hides money that actually left the household.

## Currency: look up the real historical daily rate, for both apps

Superseded design decision: rather than one static USD/CAD rate, **both this app and the existing Due Diligence app should convert at the actual historical daily rate for the date in question.** This is a shared, umbrella-level capability, not something specific to expenditures — build it once and use it in both places.

**Data source:** the [Bank of Canada Valet API](https://www.bankofcanada.ca/valet-api-how-to/) — free, public, no API key, stable/versioned since 2017. Daily USD/CAD average rate: `GET https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=<date>&end_date=<date>`. This is the authoritative Canadian-dollar rate source and fits the umbrella's existing style of calling external HTTP APIs directly with `fetch()` (no SDK), the same way `server/mailer.js` calls Microsoft Graph and `server/claude.js` calls Anthropic.

**Shared module — `server/fx.js`:**
- `async function getDailyRate(dateStr, pair = 'USDCAD')` — checks a local cache table first; on a miss, calls the Valet API for a short window ending at `dateStr` (e.g. the preceding 7 days) and takes the **last observation on or before** the requested date. This is required, not optional: the Bank of Canada only publishes rates on business days, so weekends/holidays have no observation and must fall back to the most recent prior business day's rate (standard FX convention) — a single-date query will 404/return empty on those days.
- Cache table (new migration, shared — not `expenditure_`-prefixed since Due Diligence uses it too): `fx_rates(requested_date TEXT, pair TEXT, rate REAL, rate_date TEXT, source TEXT, fetched_at TEXT, PRIMARY KEY(requested_date, pair))`. `rate_date` records which actual date's published rate was used (may differ from `requested_date` over a weekend/holiday), so the fallback is auditable rather than silent.
- If the Valet API is unreachable, fall back to the most recent rate already cached locally and mark the record so it can be revisited (don't block ingestion on a network blip, but don't pretend the number is authoritative either).
- Expose `GET /api/fx-rate?date=YYYY-MM-DD&pair=USDCAD` at the umbrella level (mounted in `server/index.js`, not per-app) so browser-side code (Due Diligence's `finance.js`) can call it too, not just server-side code.

**Precompute and store, don't look up live on every read.** Both apps should resolve the day's rate once, at the point a USD amount is entered/imported, and persist both the rate and the CAD-equivalent — not re-resolve it on every report render. This keeps historical figures stable (a later code or cache change can't silently reshuffle a number you already reviewed) and avoids a network/cache round-trip on every page load:

- **Expenditure app:** at import time, call `getDailyRate(txn_date)` per USD transaction; store `fx_rate` and `amount_cad` on `expenditure_transactions`. Reports/charts total and filter on `amount_cad`.
- **Due Diligence app:** `public/finance.js`'s `activityImpact` currently multiplies by a hardcoded constant table (`const ACTIVITY_FX={CAD:1,USD:1.3775,EUR:1.6075,GBP:1.72}`). Since `activityImpact` is a synchronous pure function used both server-side (the `node --test` suite) and client-side, switching to a real network/cache lookup means it can no longer resolve the rate inline — **resolve the rate once when an activity is created or edited** (using the activity's `created_at`/`updated_at` date as "the day of the transaction," since activities don't carry a separate transaction date today — see `activities` schema), store it as new `fx_rate`/`amount_cad` columns on `activities` (new migration), and have `activityImpact` consume the precomputed `amount_cad` instead of re-deriving it from a currency + static rate. This is a real refactor of existing, working code, not just a constant swap — treat it as its own step, with the existing `server/finance.test.js` suite updated and passing before moving on.
- Also update the hardcoded `× 1.3775 CAD/USD` cross-check literal in `server/claude.js`'s A5 extraction prompt (used to narrate the portfolio's currency-composition derivation) to use the looked-up rate for the portfolio snapshot's own `asOf` date instead of a hardcoded literal, for the same reason.

## Categorization

- Starter list of ~15-20 categories, editable later: Groceries, Dining & Takeout, Utilities, Housing (Mortgage/Rent/Property Tax), Home Maintenance & Landscaping, Insurance, Healthcare & Medical, Transportation & Auto, Travel, Entertainment & Subscriptions, Shopping & Retail, Personal Care, Professional Services (legal/accounting — e.g. "MILLER THOMSON"), Gifts & Donations, Kids & Family, Pets, Bank/Card Fees, Taxes, Miscellaneous/Unknown, Transfers (excluded from spending totals but tracked).
- Categorize by matching payee/description against a **rules table** (payee substring or regex → category) stored in the database, editable from the UI (add/rename/merge categories, add new payee→category rules, and re-run categorization on existing data after a rule change). Keep this deterministic and local rather than calling Claude per-transaction — it needs to be fast, free to re-run over the full history, and precisely correctable by the user.
- If no rule matches, assign "Miscellaneous/Unknown" — never guess a specific category with low confidence.
- Provide a simple UI flow to review and re-categorize "Unknown" items and turn that correction into a reusable rule (so the unknown bucket shrinks as the user works through it).

## Data model

New tables in the umbrella's existing `data/ic.db` (same database as Due Diligence/Tasks/Meetings — no second database file). Unlike the other three apps, expenditure data is **not one shared dataset visible to everyone with a role** — it's partitioned into independent **ledgers**, each visible only to its own members, so Reg & Sheri-Dawn's household expenditures and a possible future Ross- or Lucas-only ledger never share data or visibility:

- `expenditure_ledgers`: id, name (e.g. "Reg & Sheri-Dawn Household"), created_at
- `expenditure_ledger_members`: ledger_id, user_id, role (`admin`/`member`, scoped to that ledger only — no umbrella-wide `viewer` concept needed here)
- `expenditure_accounts`: id, **ledger_id**, name, institution, account_type (chequing/credit_card), currency, external_identifier (e.g. last-4)
- `expenditure_statements`: id, account_id, period_start, period_end, source_filename, imported_at, opening_balance, closing_balance, reconciliation_status
- `expenditure_transactions`: id, account_id, statement_id, txn_date, post_date (nullable, cards only), description, raw_description, amount, currency, fx_rate, amount_cad, category_id (nullable), is_transfer (bool), notes
- `expenditure_categories`: id, **ledger_id**, name, is_expenditure (bool — false for Transfers)
- `expenditure_category_rules`: id, ledger_id, pattern, match_type (substring/regex), category_id, priority

Categories are per-ledger (not shared) so each ledger's category list, rules, and corrections stay independent — a future Ross/Lucas ledger starts from its own clean starter category list rather than inheriting or leaking into Reg/Sheri-Dawn's.

Prefix these tables (`expenditure_…`) to keep them clearly namespaced alongside `opportunities`, `tasks`, `meetings`, etc. in the shared schema. Add them via numbered migration files in `server/migrations/` following the existing pattern (`module.exports = function (db) { db.exec(...) }`) — the highest existing migration is `020_opportunity_documents.js`, so start new ones at `021`.

## Permissions — per-ledger, not the umbrella's usual per-app role

The other three apps use one shared dataset with a graduated per-app role (`dd_role`/`tasks_role`/`meetings_role`: `admin`/`member`/`viewer`), and an FO admin (`is_fo_admin`) is automatically an admin of every app. **Do not reuse that pattern here** — it assumes one shared dataset everyone with a role can see, which is the opposite of what's wanted.

- For v1, create exactly one ledger ("Reg & Sheri-Dawn Household") with **Reg and Sheri-Dawn as its only two members** — no other family member (including Ross and Lucas, and including any future FO admin who isn't a member of that ledger) can see it. A user with no ledger membership gets no access to `/expenditure` at all, not a read-only view.
- **`is_fo_admin`'s existing "automatically admin of every app" rule does NOT extend to ledger data — confirmed.** An FO admin's power here is administrative only (e.g. creating a new ledger for a new household member, or adding/removing ledger members) — not automatic visibility into another ledger's transactions. This is a deliberate, confirmed deviation from the umbrella's existing convention, for now, because this data is materially more personal than a due-diligence checklist or a task list. Revisit later if oversight access is ever wanted.
- This structure is what "keeps the option open" for Ross and/or Lucas: adding their own expenditure tracking later is just creating a second `expenditure_ledgers` row with them as its only member(s) — same schema, same code path, zero changes needed to Reg & Sheri-Dawn's ledger, and no cross-visibility by default.

## Reporting & UI requirements

- Filter controls: date range (quick presets — this month, last month, this year, last year — plus custom), category (multi-select), payee (search/multi-select).
- "Compare two periods" mode: pick period A and period B (each independently filterable by the same category/payee filters), show totals side-by-side per category and a combined trend chart.
- Chart types: category breakdown (bar or pie) for a period, spend-over-time trend (line, monthly buckets), and the two-period comparison view above.
- Every report/chart view needs a "Print" and "Email as PDF" action.
- All figures are in CAD (see currency conversion above) — a single unified total, not split by currency.

## Frontend: match the existing umbrella pages, not a new framework

The other three apps are plain server-rendered static HTML pages (`public/due-diligence.html`, `public/tasks.html`, `public/meetings.html`) loading React 18 via CDN `<script>` tags (`unpkg.com/react@18`, no build step, no JSX — `React.createElement`/`h()` calls written directly) plus a shared `public/finance.js` for cross-cutting logic. Add `public/expenditure.html` the same way: same React-via-CDN pattern, own inline script, no bundler, no new frontend framework. There's no existing charting library in this app (the one existing chart, `LiquidityChart` in `due-diligence.html`, is hand-drawn SVG) — for the category/trend/comparison charts this app needs, adding **Chart.js via CDN** (`cdn.jsdelivr.net` or similar, same `<script src>` pattern as React) is a reasonable, low-friction addition rather than hand-rolling several chart types from scratch.

## Backend: match the existing module pattern

- New `server/expenditure.js` exporting a `registerExpenditureRoutes(app)` function, mounted from `server/index.js` the same way `registerTaskRoutes`/`registerMeetingRoutes` are, plus a static-page route (`app.get('/expenditure', ...)`) alongside the existing `/tasks`/`/meetings` routes.
- Use the existing `db` from `server/db.js` (Node's built-in `node:sqlite`, synchronous `DatabaseSync`) — no new ORM or database driver.
- Add a tile for "Household Expenditures" to `public/home.html`'s app-picker, matching the existing tile markup for the other three apps.
- File upload handling (zips/PDFs) should follow whatever pattern the existing PDF-upload endpoints in `due-diligence.html`'s admin flows already use for getting a PDF to the server as base64.

## Export

- **PDF generation:** none of the existing apps generate a PDF report today (Meetings emails HTML minutes; the `.ics` calendar file is hand-built XML, not a PDF), so this is a genuinely new capability for the umbrella. Use **`pdfkit`** (draw-based — text, tables, lines) for the report layout, with **`chartjs-node-canvas`** rendering the same Chart.js config used on-screen to a PNG (via `node-canvas`, no browser) for embedding chart images in the PDF. Deliberately **not** Puppeteer: this app runs inside the same single Node process as Due Diligence/Tasks/Meetings on one shared host, and a headless-Chrome instance's memory spike (~200-500MB) on every export is a shared-process cost that a low-frequency, two-user report export doesn't justify — `pdfkit` + `chartjs-node-canvas` gets real chart images without a browser dependency, at the cost of hand-building the report layout once (a filtered transaction table + a couple of chart types + totals is not a large lift).
- **Email:** send the generated PDF through the existing `server/mailer.js` (Microsoft Graph, not SMTP) — it already supports arbitrary base64 attachments (`sendMail({ to, subject, html, attachments })`, used today for the Meetings `.ics` invite), so no new mail infrastructure is needed. Prompt for recipient(s) at send time.

## Suggested build order

1. **Shared FX module first:** `server/fx.js` + `fx_rates` migration + `/api/fx-rate` endpoint, with its own tests (cache hit, weekend/holiday fallback, API-down fallback). This unblocks both the expenditure import pipeline and the Due Diligence `activityImpact` refactor.
2. **Due Diligence FX refactor:** add `fx_rate`/`amount_cad` to `activities`, resolve at create/edit time, update `activityImpact` to consume the precomputed value, update `server/finance.test.js`, and update the `1.3775` literal in `claude.js`'s A5 prompt. Confirm the existing test suite passes before moving on — this touches working, in-use code.
3. **Ledger schema + migrations:** `expenditure_ledgers`, `expenditure_ledger_members`, and the `expenditure_*` tables (ledger-scoped as described above), seeded with the one Reg/Sheri-Dawn ledger.
4. **Extraction:** build `extractStatement` in `server/claude.js` and a manual test against one known-good statement PDF of each of the three account types; verify against the source PDF by eye.
5. **Import pipeline:** zip/PDF upload endpoint, dedupe by account+period, run extraction, reconcile against the statement's own stated totals, resolve each transaction's daily FX rate, persist to `expenditure_transactions`. Run it across the full historical backfill (all 5 zips in the Financial folder) and fix issues until reconciliation is clean.
6. **Transfer detection + categorization:** implement the rules table and starter category list; run over the full imported history and confirm the "Unknown" bucket is small and sensible.
7. **Reporting UI:** filters, single-period report/chart views, on `public/expenditure.html`, scoped to the requesting user's ledger(s).
8. **Comparative period view.**
9. **PDF export** (`pdfkit` + `chartjs-node-canvas`), then **email send** (existing mailer).
10. **Categorization review workflow** (turn manual recategorization into reusable rules) and polish; add the home-page tile, gated on ledger membership rather than a simple role check.

Work through the phases in order and check in real output (reconciliation results, category breakdowns) rather than building the full pipeline blind — this data is financially sensitive and needs to be verifiably correct, not just plausible-looking.

## Decided (no longer open)

- Tech stack: Node/Express/`node:sqlite`, inside `ic-app`, not a separate project.
- USD→CAD: real historical daily rate via the Bank of Canada Valet API, resolved and stored per transaction/activity at entry time — not a single static rate. Built as a shared `server/fx.js` used by both this app and the existing Due Diligence app (replacing its hardcoded `1.3775`).
- Income (interest, etc.): excluded entirely, no separate view.
- Statement ingestion: must accept both zip archives and individual PDFs.
- Visibility: expenditure data is per-ledger, not umbrella-wide. v1 ships one ledger for Reg and Sheri-Dawn only; the schema is deliberately built so a Ross- and/or Lucas-only ledger can be added later with no visibility into each other's data. `is_fo_admin` does **not** auto-grant access to this app, unlike the other three — confirmed for now, revisit later if oversight access is ever wanted.
- PDF export: `pdfkit` + `chartjs-node-canvas` (hand-built report layout, real chart images, no browser dependency), not Puppeteer — see Export above for the reasoning.

## Still open — confirm before/while building

None — ready to build.
