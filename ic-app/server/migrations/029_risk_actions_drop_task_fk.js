// risk_actions.task_id was originally declared as a foreign key REFERENCES tasks(id).
// That blocks the intended flow (RFO_Risk_App_BuildSpec_v1 §6.5): deleting a promoted
// task in the Family Task List should leave risk_actions.task_id dangling, with the
// action falling back to its own status — an enforced FK makes that DELETE fail instead.
//
// This rebuilds risk_actions without the FK, only if a database applied the earlier
// version of migration 027. Fresh installs already get the corrected shape from 027 and
// this is a no-op for them.
module.exports = function (db) {
  const info = db.prepare('PRAGMA table_info(risk_actions)').all();
  if (!info.length) return; // 027 hasn't created it yet on this DB — nothing to fix.
  const fks = db.prepare('PRAGMA foreign_key_list(risk_actions)').all();
  const hasTaskFk = fks.some((f) => f.table === 'tasks');
  if (!hasTaskFk) return; // already correct.

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    CREATE TABLE risk_actions__new (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES risk_categories(id),
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL,
      owner_text TEXT NOT NULL DEFAULT '',
      due_quarter TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      task_id TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO risk_actions__new
      SELECT id, category_id, title, detail, priority, owner_text, due_quarter, status, task_id, created_by, created_at, updated_at
      FROM risk_actions;
    DROP TABLE risk_actions;
    ALTER TABLE risk_actions__new RENAME TO risk_actions;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
};
