// Household Expenditure Reporting — see RFO_Expenditure_App_BuildSpec_v1.md.
//
// Unlike the other three apps, expenditure data is NOT one shared dataset governed by a
// single per-app role column — it's partitioned into independent ledgers, each visible
// only to its own members, so a ledger's data never leaks to anyone outside it. In
// particular, is_fo_admin does NOT auto-grant access here the way it does for
// dd_role/tasks_role/meetings_role — confirmed deliberately, since this data is more
// personal than a due-diligence checklist or a task list. See server/expenditure.js for
// the access-check helpers that enforce this.
//
// Schema only — the initial "Reg & Sheri-Dawn Household" ledger and its starter category
// list are seeded from server/seed.js's ensureSeeded(), not here, since that seeding
// needs the 'reg'/'sd' user rows to already exist and this migration can run (on a truly
// fresh database) before seed.js ever creates them — migrations run once at boot, in
// order, ahead of ensureSeeded().
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS expenditure_ledgers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenditure_ledger_members (
      ledger_id TEXT NOT NULL REFERENCES expenditure_ledgers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (ledger_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS expenditure_accounts (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES expenditure_ledgers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      institution TEXT,
      account_type TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'CAD',
      external_identifier TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_accounts_ledger ON expenditure_accounts(ledger_id);

    CREATE TABLE IF NOT EXISTS expenditure_statements (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES expenditure_accounts(id) ON DELETE CASCADE,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      source_filename TEXT,
      imported_at TEXT NOT NULL,
      opening_balance REAL,
      closing_balance REAL,
      reconciliation_status TEXT NOT NULL DEFAULT 'unreconciled',
      reconciliation_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_statements_account ON expenditure_statements(account_id);
    -- Dedupe by account + statement period, not by filename (the same statement can
    -- arrive in more than one zip, or be re-uploaded) — see the build spec.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expenditure_statements_period ON expenditure_statements(account_id, period_start, period_end);

    CREATE TABLE IF NOT EXISTS expenditure_categories (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES expenditure_ledgers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_expenditure INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_categories_ledger ON expenditure_categories(ledger_id);

    CREATE TABLE IF NOT EXISTS expenditure_category_rules (
      id TEXT PRIMARY KEY,
      ledger_id TEXT NOT NULL REFERENCES expenditure_ledgers(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'substring',
      category_id TEXT NOT NULL REFERENCES expenditure_categories(id) ON DELETE CASCADE,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_category_rules_ledger ON expenditure_category_rules(ledger_id);

    -- amount/amount_cad/fx_rate: amount is in the transaction's own currency; amount_cad
    -- is that amount converted at fx_rate (the day-of-transaction rate resolved via
    -- server/fx.js at import time — see the build spec's currency-conversion section).
    -- For CAD transactions, fx_rate is NULL and amount_cad simply equals amount.
    CREATE TABLE IF NOT EXISTS expenditure_transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES expenditure_accounts(id) ON DELETE CASCADE,
      statement_id TEXT NOT NULL REFERENCES expenditure_statements(id) ON DELETE CASCADE,
      txn_date TEXT NOT NULL,
      post_date TEXT,
      description TEXT NOT NULL,
      raw_description TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      fx_rate REAL,
      amount_cad REAL NOT NULL,
      category_id TEXT REFERENCES expenditure_categories(id),
      is_transfer INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenditure_transactions_account ON expenditure_transactions(account_id);
    CREATE INDEX IF NOT EXISTS idx_expenditure_transactions_statement ON expenditure_transactions(statement_id);
    CREATE INDEX IF NOT EXISTS idx_expenditure_transactions_category ON expenditure_transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_expenditure_transactions_date ON expenditure_transactions(txn_date);
  `);
};
