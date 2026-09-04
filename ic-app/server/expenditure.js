// Household Expenditure Reporting module — see RFO_Expenditure_App_BuildSpec_v1.md.
// Mounted onto the main app from index.js, same pattern as tasks.js/meetings.js.
//
// Access model deliberately differs from the other three apps: data is partitioned into
// independent ledgers (expenditure_ledgers/expenditure_ledger_members), not one shared
// dataset governed by a per-app role column, and is_fo_admin does NOT auto-grant access
// — see migration 023's header comment. Every route below resolves the caller's own
// ledger membership and scopes all reads/writes to it; there is no cross-ledger admin
// path here.
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const { requireAuth } = require('./auth');
const claude = require('./claude');
const fx = require('./fx');
const mailer = require('./mailer');
const { logApiUsage } = require('./usage');
const { escapeHtml, contentRow, paragraph, emailShell } = require('./email-template');
const { buildReportPdf } = require('./expenditure-report');

const FX_PAIRS = { USD: 'USDCAD', EUR: 'EURCAD', GBP: 'GBPCAD' };
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://rfo.quaysolutions.ca';

// A transaction description is treated as a transfer/non-expenditure item (and excluded
// from spending totals, though still stored and visible — see the build spec's
// "Transfer / non-expenditure detection" section) if it matches one of these prefixes,
// or — on the credit card only — is a negative amount whose description reads as a
// payment (paying down the card from chequing; the actual purchases behind that payment
// already appear as their own line items, so excluding the payment avoids double
// counting). A refund/credit for a returned purchase is a negative amount that does NOT
// mention "payment" and stays a real (negative) expenditure.
//
// Deliberately NOT matched here: e-Transfers to a named vendor/person for real goods or
// services (landscaping, contractors, etc.) — those are legitimate spending even though
// they move via e-Transfer, and only an "internal transfer to your own account" framing
// should be excluded. Since a statement description alone can't always distinguish "sent
// to my own other account" from "sent to a vendor," this errs toward keeping an
// ambiguous e-Transfer as a categorized expenditure rather than silently excluding real
// spending — see the build spec for the reasoning.
const TRANSFER_PATTERNS = [
  /^online banking transfer/i,
  /^online banking payment/i,
  /^account transfer/i,
  /^funds transfer/i,
  /^investment /i,
  /^deposit interest/i,
  /^interest /i,
];

function isTransferOrIncome(description, accountType, amount) {
  const desc = (description || '').trim();
  if (TRANSFER_PATTERNS.some((re) => re.test(desc))) return true;
  if (accountType === 'credit_card' && amount < 0 && /payment/i.test(desc)) return true;
  return false;
}

// Recognizes this household's real RBC statement filenames (see the build spec) and
// returns the account this file belongs to, or null if the name doesn't match any known
// pattern — the caller then needs the account picked/created manually rather than
// guessing wrong. Matching is intentionally on distinguishing substrings, not an exact
// template, since exact date/suffix formatting varies (e.g. a " (1)" duplicate suffix).
function detectAccountFromFilename(filename) {
  const name = filename || '';
  const cadChequing = /CAD Chequing (\d+)/i.exec(name);
  if (cadChequing) return { name: 'RBC CAD Chequing', accountType: 'chequing', currency: 'CAD', externalIdentifier: cadChequing[1].slice(-4) };
  const usdChequing = /USD Chequing (\d+)/i.exec(name);
  if (usdChequing) return { name: 'RBC USD Chequing', accountType: 'chequing', currency: 'USD', externalIdentifier: usdChequing[1].slice(-4) };
  const card = /Statement-(\d{4})/i.exec(name);
  if (card && /priv/i.test(name)) return { name: 'RBC Avion Visa Infinite Privilege', accountType: 'credit_card', currency: 'CAD', externalIdentifier: card[1] };
  return null;
}

module.exports = function registerExpenditureRoutes(app, { db, logAudit }) {
  // In-memory import job tracking — see the POST /api/expenditure/import handler below
  // for why this isn't a synchronous request. Lives for the process's lifetime; a
  // finished job is swept out after an hour so this doesn't grow without bound over
  // months of occasional use (results have long since been read by then).
  const importJobs = new Map();
  function scheduleJobCleanup(jobId) {
    setTimeout(() => importJobs.delete(jobId), 60 * 60 * 1000).unref();
  }

  function myLedger(userId) {
    return db.prepare(
      `SELECT l.id, l.name, m.role FROM expenditure_ledgers l
       JOIN expenditure_ledger_members m ON m.ledger_id = l.id
       WHERE m.user_id = ?`
    ).get(userId);
  }

  // Every route needs the caller's ledger; a user with no membership gets a 403, not a
  // read-only or empty view — see migration 023's header comment.
  function requireLedger(req, res, next) {
    const ledger = myLedger(req.session.userId);
    if (!ledger) return res.status(403).json({ error: 'You do not have access to Household Expenditures.' });
    req.expenditureLedger = ledger;
    next();
  }

  app.get('/api/expenditure/ledger', requireAuth, requireLedger, (req, res) => {
    res.json(req.expenditureLedger);
  });

  // ---- accounts ----

  function accountRowToJson(row) {
    return { id: row.id, name: row.name, institution: row.institution, accountType: row.account_type, currency: row.currency, externalIdentifier: row.external_identifier, createdAt: row.created_at };
  }

  app.get('/api/expenditure/accounts', requireAuth, requireLedger, (req, res) => {
    const rows = db.prepare('SELECT * FROM expenditure_accounts WHERE ledger_id = ? ORDER BY name').all(req.expenditureLedger.id);
    res.json(rows.map(accountRowToJson));
  });

  function findOrCreateAccount(ledgerId, detected) {
    const existing = db.prepare(
      'SELECT * FROM expenditure_accounts WHERE ledger_id = ? AND account_type = ? AND external_identifier = ?'
    ).get(ledgerId, detected.accountType, detected.externalIdentifier);
    if (existing) return existing;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO expenditure_accounts (id, ledger_id, name, institution, account_type, currency, external_identifier, created_at)
       VALUES (?, ?, ?, 'RBC', ?, ?, ?, ?)`
    ).run(id, ledgerId, detected.name, detected.accountType, detected.currency, detected.externalIdentifier, now);
    return db.prepare('SELECT * FROM expenditure_accounts WHERE id = ?').get(id);
  }

  // ---- categories & rules ----

  function categoryRowToJson(row) {
    return { id: row.id, name: row.name, isExpenditure: !!row.is_expenditure, sortOrder: row.sort_order };
  }

  app.get('/api/expenditure/categories', requireAuth, requireLedger, (req, res) => {
    const rows = db.prepare('SELECT * FROM expenditure_categories WHERE ledger_id = ? ORDER BY sort_order').all(req.expenditureLedger.id);
    res.json(rows.map(categoryRowToJson));
  });

  app.post('/api/expenditure/categories', requireAuth, requireLedger, (req, res) => {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = crypto.randomUUID();
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM expenditure_categories WHERE ledger_id = ?').get(req.expenditureLedger.id).m;
    db.prepare('INSERT INTO expenditure_categories (id, ledger_id, name, is_expenditure, sort_order) VALUES (?, ?, ?, 1, ?)').run(id, req.expenditureLedger.id, name, maxSort + 1);
    res.status(201).json(categoryRowToJson(db.prepare('SELECT * FROM expenditure_categories WHERE id = ?').get(id)));
  });

  // Rename and/or flip whether a category counts toward spending totals (the "Transfers"
  // category is the one that ships with isExpenditure=false; a household could
  // conceivably want another one treated the same way).
  app.put('/api/expenditure/categories/:id', requireAuth, requireLedger, (req, res) => {
    const row = db.prepare('SELECT * FROM expenditure_categories WHERE id = ? AND ledger_id = ?').get(req.params.id, req.expenditureLedger.id);
    if (!row) return res.status(404).json({ error: 'Category not found' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : row.name;
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    const isExpenditure = req.body?.isExpenditure !== undefined ? (req.body.isExpenditure ? 1 : 0) : row.is_expenditure;
    db.prepare('UPDATE expenditure_categories SET name = ?, is_expenditure = ? WHERE id = ?').run(name, isExpenditure, req.params.id);
    res.json(categoryRowToJson(db.prepare('SELECT * FROM expenditure_categories WHERE id = ?').get(req.params.id)));
  });

  // Blocks deleting a category that's still in use (by a transaction or a rule) with a
  // clear count, rather than either silently orphaning references or surfacing a raw
  // foreign-key constraint error — recategorize/delete those first.
  app.delete('/api/expenditure/categories/:id', requireAuth, requireLedger, (req, res) => {
    const row = db.prepare('SELECT * FROM expenditure_categories WHERE id = ? AND ledger_id = ?').get(req.params.id, req.expenditureLedger.id);
    if (!row) return res.status(404).json({ error: 'Category not found' });
    const txnCount = db.prepare(
      `SELECT COUNT(*) AS n FROM expenditure_transactions t JOIN expenditure_accounts a ON a.id = t.account_id WHERE a.ledger_id = ? AND t.category_id = ?`
    ).get(req.expenditureLedger.id, req.params.id).n;
    const ruleCount = db.prepare('SELECT COUNT(*) AS n FROM expenditure_category_rules WHERE ledger_id = ? AND category_id = ?').get(req.expenditureLedger.id, req.params.id).n;
    if (txnCount > 0 || ruleCount > 0) {
      return res.status(400).json({ error: `Can't delete "${row.name}" — it's used by ${txnCount} transaction${txnCount === 1 ? '' : 's'} and ${ruleCount} rule${ruleCount === 1 ? '' : 's'}. Recategorize or remove those first.` });
    }
    db.prepare('DELETE FROM expenditure_categories WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  function ruleRowToJson(row) {
    return { id: row.id, pattern: row.pattern, matchType: row.match_type, categoryId: row.category_id, priority: row.priority };
  }

  app.get('/api/expenditure/category-rules', requireAuth, requireLedger, (req, res) => {
    const rows = db.prepare('SELECT * FROM expenditure_category_rules WHERE ledger_id = ? ORDER BY priority DESC, created_at').all(req.expenditureLedger.id);
    res.json(rows.map(ruleRowToJson));
  });

  // Creating a rule optionally re-applies it to every existing uncategorized (Unknown)
  // or previously-matched-by-a-lower-priority-rule transaction — the build spec's
  // "review Unknown items, turn the correction into a reusable rule" workflow. Callers
  // that just want to add a rule without touching history pass applyToExisting: false.
  app.post('/api/expenditure/category-rules', requireAuth, requireLedger, (req, res) => {
    const b = req.body || {};
    if (!b.pattern || !b.categoryId) return res.status(400).json({ error: 'pattern and categoryId are required' });
    const category = db.prepare('SELECT * FROM expenditure_categories WHERE id = ? AND ledger_id = ?').get(b.categoryId, req.expenditureLedger.id);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO expenditure_category_rules (id, ledger_id, pattern, match_type, category_id, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, req.expenditureLedger.id, b.pattern, b.matchType === 'regex' ? 'regex' : 'substring', b.categoryId, Number(b.priority) || 0, now);
    let reclassified = 0;
    if (b.applyToExisting) {
      const targetCategoryId = db.prepare("SELECT id FROM expenditure_categories WHERE ledger_id = ? AND name = 'Miscellaneous/Unknown'").get(req.expenditureLedger.id)?.id;
      const candidates = db.prepare(
        `SELECT t.id, t.raw_description FROM expenditure_transactions t
         JOIN expenditure_accounts a ON a.id = t.account_id
         WHERE a.ledger_id = ? AND t.is_transfer = 0 AND (t.category_id = ? OR t.category_id IS NULL)`
      ).all(req.expenditureLedger.id, targetCategoryId || '__none__');
      const rule = db.prepare('SELECT * FROM expenditure_category_rules WHERE id = ?').get(id);
      for (const c of candidates) {
        if (matchesRule(c.raw_description, rule)) {
          db.prepare('UPDATE expenditure_transactions SET category_id = ? WHERE id = ?').run(b.categoryId, c.id);
          reclassified++;
        }
      }
    }
    res.status(201).json({ rule: ruleRowToJson(db.prepare('SELECT * FROM expenditure_category_rules WHERE id = ?').get(id)), reclassified });
  });

  app.delete('/api/expenditure/category-rules/:id', requireAuth, requireLedger, (req, res) => {
    const row = db.prepare('SELECT * FROM expenditure_category_rules WHERE id = ? AND ledger_id = ?').get(req.params.id, req.expenditureLedger.id);
    if (!row) return res.status(404).json({ error: 'Rule not found' });
    db.prepare('DELETE FROM expenditure_category_rules WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  function matchesRule(description, rule) {
    if (!description) return false;
    if (rule.match_type === 'regex') {
      try { return new RegExp(rule.pattern, 'i').test(description); } catch { return false; }
    }
    return description.toLowerCase().includes(rule.pattern.toLowerCase());
  }

  // Highest-priority matching rule wins; ties broken by whichever rule was created most
  // recently (a later, presumably more specific correction should win over an older,
  // broader one at the same priority).
  function categorize(ledgerId, description) {
    const rules = db.prepare('SELECT * FROM expenditure_category_rules WHERE ledger_id = ? ORDER BY priority DESC, created_at DESC').all(ledgerId);
    for (const rule of rules) {
      if (matchesRule(description, rule)) return rule.category_id;
    }
    return null;
  }

  function unknownCategoryId(ledgerId) {
    return db.prepare("SELECT id FROM expenditure_categories WHERE ledger_id = ? AND name = 'Miscellaneous/Unknown'").get(ledgerId)?.id || null;
  }

  function transfersCategoryId(ledgerId) {
    return db.prepare("SELECT id FROM expenditure_categories WHERE ledger_id = ? AND name = 'Transfers'").get(ledgerId)?.id || null;
  }

  // ---- payee research (web search, opt-in per payee — never run automatically) ----

  // Distinct descriptions still sitting in Miscellaneous/Unknown, with how many
  // transactions share each one — the review queue for research/manual categorization.
  // Grouping by description matters: the same payee (e.g. a recurring grocery run)
  // typically posts many times, so researching it once and creating a rule from it
  // clears every occurrence at once rather than one at a time.
  app.get('/api/expenditure/unknown-payees', requireAuth, requireLedger, (req, res) => {
    const unknownId = unknownCategoryId(req.expenditureLedger.id);
    if (!unknownId) return res.json([]);
    const rows = db.prepare(
      `SELECT t.raw_description AS description, COUNT(*) AS count
       FROM expenditure_transactions t JOIN expenditure_accounts a ON a.id = t.account_id
       WHERE a.ledger_id = ? AND t.category_id = ? AND t.is_transfer = 0
       GROUP BY t.raw_description ORDER BY count DESC`
    ).all(req.expenditureLedger.id, unknownId);
    res.json(rows);
  });

  // Web-search-backed category suggestion for one payee description — never applied
  // automatically; the caller reviews it and, if they agree, creates a rule from it via
  // the existing POST /api/expenditure/category-rules (same flow as a manual "+Rule").
  // This is a real Anthropic API cost per call (small, but real), so it only ever runs
  // when a person clicks something — no automatic research on import.
  app.post('/api/expenditure/research-payee', requireAuth, requireLedger, async (req, res) => {
    const description = (req.body?.description || '').trim();
    if (!description) return res.status(400).json({ error: 'description is required' });
    const categoryNames = db.prepare(
      "SELECT name FROM expenditure_categories WHERE ledger_id = ? AND is_expenditure = 1 ORDER BY sort_order"
    ).all(req.expenditureLedger.id).map((r) => r.name);
    try {
      const { result, usage } = await claude.suggestCategory(description, categoryNames);
      logApiUsage({ callType: 'expenditure_suggest_category', usage, userId: req.session.userId });
      const categoryRow = db.prepare('SELECT id FROM expenditure_categories WHERE ledger_id = ? AND name = ?').get(req.expenditureLedger.id, result.category);
      res.json({ ...result, categoryId: categoryRow ? categoryRow.id : null });
    } catch (err) {
      if (err instanceof claude.ClaudeNotConfiguredError) {
        return res.status(503).json({ error: 'NOT_CONFIGURED', message: err.message });
      }
      res.status(502).json({ error: err.message || 'Research failed' });
    }
  });

  // ---- import (zip or individual PDFs) ----

  // Body: { files: [{ filename, base64 }] }. A .zip is expanded server-side (skipping
  // non-PDF entries and macOS __MACOSX junk); a .pdf is used as-is. Each resulting
  // statement PDF is extracted via Claude (server/claude.js#extractStatement — see its
  // header comment for why: these statements' two-column layout breaks plain text
  // extraction), reconciled against its own reported totals, and — if the account
  // pattern isn't recognized — skipped with an error the caller can surface, rather than
  // guessing which account it belongs to.
  //
  // Import runs as a background job, not inline in this request: extracting even one
  // dense statement can take minutes, and a zip of a full year's statements does that
  // several times over — comfortably past the hosting platform's own reverse-proxy
  // timeout (independent of anything this app's own code does, so a longer server-side
  // timeout alone doesn't fix it). This route does the fast, synchronous part (parse the
  // zip, validate files) and returns a jobId immediately; the actual per-statement
  // extraction runs after the response is sent, tracked in the in-memory `importJobs`
  // map below and polled via GET /api/expenditure/import/:jobId. Job state is
  // intentionally not persisted to the database — it's fine if a mid-import server
  // restart loses progress, since already-imported statements are already in the
  // database and re-uploading the same zip just skips them (dedup by account+period).
  app.post('/api/expenditure/import', requireAuth, requireLedger, (req, res) => {
    const files = req.body?.files;
    if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ error: 'files is required' });

    const pdfEntries = [];
    for (const f of files) {
      if (!f?.filename || !f?.base64) continue;
      if (/\.zip$/i.test(f.filename)) {
        try {
          const zip = new AdmZip(Buffer.from(f.base64, 'base64'));
          for (const entry of zip.getEntries()) {
            if (entry.isDirectory || !/\.pdf$/i.test(entry.entryName) || entry.entryName.includes('__MACOSX')) continue;
            pdfEntries.push({ filename: entry.entryName.split('/').pop(), base64: entry.getData().toString('base64') });
          }
        } catch (err) {
          pdfEntries.push({ filename: f.filename, error: `Could not open zip: ${err.message}` });
        }
      } else if (/\.pdf$/i.test(f.filename)) {
        pdfEntries.push({ filename: f.filename, base64: f.base64 });
      }
    }
    if (pdfEntries.length === 0) return res.status(400).json({ error: 'No PDF statements found in the uploaded file(s).' });

    const jobId = crypto.randomUUID();
    const job = { id: jobId, ledgerId: req.expenditureLedger.id, status: 'running', total: pdfEntries.length, completed: 0, results: [], startedAt: new Date().toISOString() };
    importJobs.set(jobId, job);
    res.status(202).json({ jobId, total: job.total });

    (async () => {
      for (const entry of pdfEntries) {
        if (entry.error) {
          job.results.push({ filename: entry.filename, ok: false, error: entry.error });
        } else {
          try {
            job.results.push(await importOneStatement(req.expenditureLedger.id, entry.filename, entry.base64, req.session.userId));
          } catch (err) {
            job.results.push({ filename: entry.filename, ok: false, error: err.message || 'Import failed' });
          }
        }
        job.completed++;
      }
      job.status = 'done';
      scheduleJobCleanup(jobId);
    })().catch((err) => {
      job.status = 'error';
      job.error = err.message || 'Import job failed';
      scheduleJobCleanup(jobId);
    });
  });

  app.get('/api/expenditure/import/:jobId', requireAuth, requireLedger, (req, res) => {
    const job = importJobs.get(req.params.jobId);
    if (!job || job.ledgerId !== req.expenditureLedger.id) return res.status(404).json({ error: 'Import job not found' });
    res.json({ status: job.status, total: job.total, completed: job.completed, results: job.results, error: job.error || null });
  });

  async function importOneStatement(ledgerId, filename, base64, userId) {
    const detected = detectAccountFromFilename(filename);
    if (!detected) return { filename, ok: false, error: 'Unrecognized statement filename — this account pattern isn\'t known yet.' };
    const account = findOrCreateAccount(ledgerId, detected);

    // Fast-path dedup, before spending a Claude call: this household's real statement
    // filenames end in the statement's own period-end date (confirmed against real RBC
    // exports), so a re-uploaded or overlapping-zip duplicate can usually be caught for
    // free. This is a guess only — a renamed or differently-formatted filename just falls
    // through to extraction as normal — so the authoritative check below (by the
    // statement's own reported period, after extraction) still always runs too.
    const filenameDateMatch = /(\d{4}-\d{2}-\d{2})/.exec(filename);
    if (filenameDateMatch) {
      const likelyDuplicate = db.prepare(
        'SELECT period_start, period_end FROM expenditure_statements WHERE account_id = ? AND period_end = ?'
      ).get(account.id, filenameDateMatch[1]);
      if (likelyDuplicate) {
        return { filename, ok: true, skipped: true, reason: 'Already imported', accountName: account.name, periodStart: likelyDuplicate.period_start, periodEnd: likelyDuplicate.period_end };
      }
    }

    let extraction;
    try {
      extraction = await claude.extractStatement(base64, account.account_type);
    } catch (err) {
      if (err instanceof claude.ClaudeNotConfiguredError) {
        return { filename, ok: false, error: 'Statement extraction is not configured (ANTHROPIC_API_KEY missing on the server).' };
      }
      return { filename, ok: false, error: `Extraction failed: ${err.message}` };
    }
    const data = extraction.result;
    const { periodStart, periodEnd, summary, transactions } = data;
    if (!periodStart || !periodEnd || !Array.isArray(transactions)) {
      return { filename, ok: false, error: 'Extraction did not return the expected shape.' };
    }

    const existingStatement = db.prepare(
      'SELECT id FROM expenditure_statements WHERE account_id = ? AND period_start = ? AND period_end = ?'
    ).get(account.id, periodStart, periodEnd);
    if (existingStatement) {
      return { filename, ok: true, skipped: true, reason: 'Already imported', accountName: account.name, periodStart, periodEnd };
    }

    const sumAmounts = transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    let reconciliationStatus = 'unreconciled';
    let reconciliationNote = null;
    const TOLERANCE = 1.0; // small rounding tolerance, in the account's own currency
    if (account.account_type === 'chequing' && summary?.openingBalance != null && summary?.closingBalance != null) {
      const implied = summary.openingBalance - sumAmounts;
      reconciliationStatus = Math.abs(implied - summary.closingBalance) <= TOLERANCE ? 'ok' : 'mismatch';
      if (reconciliationStatus === 'mismatch') {
        reconciliationNote = `Opening ${summary.openingBalance} - transactions ${sumAmounts.toFixed(2)} = ${implied.toFixed(2)}, but statement states closing balance ${summary.closingBalance}.`;
      }
    } else if (account.account_type === 'credit_card' && summary?.previousBalance != null && summary?.newBalance != null) {
      const implied = summary.previousBalance + sumAmounts;
      reconciliationStatus = Math.abs(implied - summary.newBalance) <= TOLERANCE ? 'ok' : 'mismatch';
      if (reconciliationStatus === 'mismatch') {
        reconciliationNote = `Previous balance ${summary.previousBalance} + transactions ${sumAmounts.toFixed(2)} = ${implied.toFixed(2)}, but statement states new balance ${summary.newBalance}.`;
      }
    }

    const statementId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO expenditure_statements (id, account_id, period_start, period_end, source_filename, imported_at, opening_balance, closing_balance, reconciliation_status, reconciliation_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      statementId, account.id, periodStart, periodEnd, filename, now,
      summary?.openingBalance ?? summary?.previousBalance ?? null,
      summary?.closingBalance ?? summary?.newBalance ?? null,
      reconciliationStatus, reconciliationNote
    );

    const unknownId = unknownCategoryId(ledgerId);
    const transfersId = transfersCategoryId(ledgerId);
    let transferCount = 0;

    for (const t of transactions) {
      const amount = Number(t.amount) || 0;
      const currency = account.currency;
      let fxRate = null;
      let amountCad = amount;
      if (currency !== 'CAD') {
        const pair = FX_PAIRS[currency];
        if (pair && t.date) {
          try {
            fxRate = await fx.getDailyRate(t.date, pair);
            amountCad = amount * fxRate;
          } catch (err) {
            console.error(`FX lookup failed while importing ${filename} (${t.date}):`, err.message);
          }
        }
      }
      const excluded = isTransferOrIncome(t.description, account.account_type, amount);
      if (excluded) transferCount++;
      const categoryId = excluded ? transfersId : (categorize(ledgerId, t.description) || unknownId);
      db.prepare(
        `INSERT INTO expenditure_transactions (id, account_id, statement_id, txn_date, post_date, description, raw_description, amount, currency, fx_rate, amount_cad, category_id, is_transfer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(), account.id, statementId, t.date, t.postDate || null, t.description, t.description,
        amount, currency, fxRate, amountCad, categoryId, excluded ? 1 : 0, now
      );
    }

    logAudit({ userId, action: 'expenditure.statement_imported', entityType: 'expenditure_statement', entityId: statementId, details: { filename, accountName: account.name, transactionCount: transactions.length, reconciliationStatus } });

    return {
      filename, ok: true, accountName: account.name, periodStart, periodEnd,
      transactionCount: transactions.length, transferCount, reconciliationStatus, reconciliationNote,
    };
  }

  // ---- transactions & reporting ----

  function txnRowToJson(row) {
    return {
      id: row.id, accountId: row.account_id, accountName: row.account_name, txnDate: row.txn_date, postDate: row.post_date,
      description: row.description, amount: row.amount, currency: row.currency, fxRate: row.fx_rate, amountCad: row.amount_cad,
      categoryId: row.category_id, categoryName: row.category_name, isTransfer: !!row.is_transfer, notes: row.notes,
    };
  }

  // Filters: dateFrom/dateTo (txn_date range, inclusive), categoryIds (comma-separated),
  // payee (substring search on description). Transfers are included only if
  // includeTransfers=true is passed — every reporting view defaults to expenditure-only.
  function queryTransactions(ledgerId, q) {
    const clauses = ['a.ledger_id = ?'];
    const params = [ledgerId];
    if (!q.includeTransfers) clauses.push('t.is_transfer = 0');
    if (q.dateFrom) { clauses.push('t.txn_date >= ?'); params.push(q.dateFrom); }
    if (q.dateTo) { clauses.push('t.txn_date <= ?'); params.push(q.dateTo); }
    if (q.payee) { clauses.push('t.description LIKE ?'); params.push(`%${q.payee}%`); }
    if (q.categoryIds) {
      const ids = String(q.categoryIds).split(',').filter(Boolean);
      if (ids.length) { clauses.push(`t.category_id IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
    }
    const sql = `
      SELECT t.*, a.name AS account_name, c.name AS category_name
      FROM expenditure_transactions t
      JOIN expenditure_accounts a ON a.id = t.account_id
      LEFT JOIN expenditure_categories c ON c.id = t.category_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.txn_date DESC`;
    return db.prepare(sql).all(...params);
  }

  app.get('/api/expenditure/transactions', requireAuth, requireLedger, (req, res) => {
    const rows = queryTransactions(req.expenditureLedger.id, req.query);
    res.json(rows.map(txnRowToJson));
  });

  app.put('/api/expenditure/transactions/:id', requireAuth, requireLedger, (req, res) => {
    const row = db.prepare(
      `SELECT t.* FROM expenditure_transactions t JOIN expenditure_accounts a ON a.id = t.account_id WHERE t.id = ? AND a.ledger_id = ?`
    ).get(req.params.id, req.expenditureLedger.id);
    if (!row) return res.status(404).json({ error: 'Transaction not found' });
    const b = req.body || {};
    db.prepare('UPDATE expenditure_transactions SET category_id = ?, is_transfer = ?, notes = ? WHERE id = ?').run(
      b.categoryId !== undefined ? b.categoryId : row.category_id,
      b.isTransfer !== undefined ? (b.isTransfer ? 1 : 0) : row.is_transfer,
      b.notes !== undefined ? b.notes : row.notes,
      req.params.id
    );
    res.json(txnRowToJson(db.prepare(
      `SELECT t.*, a.name AS account_name, c.name AS category_name FROM expenditure_transactions t
       JOIN expenditure_accounts a ON a.id = t.account_id LEFT JOIN expenditure_categories c ON c.id = t.category_id WHERE t.id = ?`
    ).get(req.params.id)));
  });

  function summarize(rows) {
    const byCategory = {};
    const byMonth = {};
    let total = 0;
    for (const r of rows) {
      const key = r.category_name || 'Uncategorized';
      byCategory[key] = (byCategory[key] || 0) + r.amount_cad;
      byMonth[r.txn_date.slice(0, 7)] = (byMonth[r.txn_date.slice(0, 7)] || 0) + r.amount_cad;
      total += r.amount_cad;
    }
    return { total, byCategory, byMonth, count: rows.length };
  }

  function buildRange(ledgerId, q) {
    const rows = queryTransactions(ledgerId, q);
    return { dateFrom: q.dateFrom || null, dateTo: q.dateTo || null, summary: summarize(rows), transactions: rows.map(txnRowToJson) };
  }

  // Summary for one period (or two, for the comparative view — call this route twice
  // client-side with each range and diff the results, rather than a single endpoint
  // trying to encode both ranges' filters at once).
  app.get('/api/expenditure/summary', requireAuth, requireLedger, (req, res) => {
    res.json(summarize(queryTransactions(req.expenditureLedger.id, req.query)));
  });

  // ---- report export (Print / Email as PDF) ----
  // A second period (compareDateFrom/compareDateTo, same categoryIds/payee filters) adds
  // a side-by-side Period A/B comparison section instead of a single-period report — the
  // build spec's "show two comparative periods" requirement.

  function reportRanges(ledgerId, q) {
    const range = buildRange(ledgerId, q);
    const compareRange = q.compareDateFrom || q.compareDateTo
      ? buildRange(ledgerId, { ...q, dateFrom: q.compareDateFrom, dateTo: q.compareDateTo })
      : null;
    return { range, compareRange };
  }

  app.get('/api/expenditure/report/pdf', requireAuth, requireLedger, async (req, res) => {
    try {
      const { range, compareRange } = reportRanges(req.expenditureLedger.id, req.query);
      const pdf = await buildReportPdf({ ledgerName: req.expenditureLedger.name, range, compareRange });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'inline; filename="expenditure-report.pdf"');
      res.send(pdf);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to generate report' });
    }
  });

  app.post('/api/expenditure/report/email', requireAuth, requireLedger, async (req, res) => {
    const { to, message } = req.body || {};
    if (!to) return res.status(400).json({ error: 'to (recipient email) is required' });
    try {
      const { range, compareRange } = reportRanges(req.expenditureLedger.id, req.body || {});
      const pdf = await buildReportPdf({ ledgerName: req.expenditureLedger.name, range, compareRange });
      await mailer.sendMail({
        to,
        subject: `Household Expenditure Report — ${req.expenditureLedger.name}`,
        html: emailShell({
          eyebrow: 'Household Expenditures',
          title: 'Expenditure Report',
          subtitle: req.expenditureLedger.name,
          bodyRowsHtml: contentRow(
            (message ? paragraph(escapeHtml(message)) : '') +
              paragraph(`Attached: the household expenditure report${range.dateFrom || range.dateTo ? ` for ${range.dateFrom || 'earliest'} to ${range.dateTo || 'latest'}` : ''}.`)
          ),
          ctaText: 'Open Household Expenditures',
          ctaUrl: `${APP_BASE_URL}/expenditure`,
        }),
        attachments: [{ name: 'expenditure-report.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }],
      });
      logAudit({ userId: req.session.userId, action: 'expenditure.report_emailed', entityType: 'expenditure_ledger', entityId: req.expenditureLedger.id, details: { to } });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof mailer.MailNotConfiguredError) {
        return res.status(503).json({ error: 'Email is not configured on the server.' });
      }
      res.status(500).json({ error: err.message || 'Failed to send report' });
    }
  });
};

// Attached to the export (rather than changing its shape) so test/expenditure.test.js
// can exercise this module's trickiest logic — transfer detection, filename-based
// account recognition — directly, without booting a real server/session.
module.exports.isTransferOrIncome = isTransferOrIncome;
module.exports.detectAccountFromFilename = detectAccountFromFilename;
