// Shared Task List module — pillars/categories mirror the family's existing
// Family_Office_Task_List_2026 Q2.xlsx tracker structure (Section 5 of the build spec).
module.exports = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pillars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_categories (
      id TEXT PRIMARY KEY,
      pillar_id TEXT NOT NULL REFERENCES pillars(id),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES task_categories(id),
      parent_task_id TEXT REFERENCES tasks(id),
      title TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      target_quarter TEXT,
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      completed_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      source_ref_id INTEGER,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      PRIMARY KEY (task_id, user_id)
    );
  `);

  const pillarCount = db.prepare('SELECT COUNT(*) AS n FROM pillars').get().n;
  if (pillarCount === 0) {
    const pillars = [
      { id: 'strategy', name: 'Strategy', sort_order: 1 },
      { id: 'people', name: 'People', sort_order: 2 },
      { id: 'core-business', name: 'Core Business', sort_order: 3 },
      { id: 'operations', name: 'Operations', sort_order: 4 },
    ];
    for (const p of pillars) {
      db.prepare('INSERT INTO pillars (id, name, sort_order) VALUES (?, ?, ?)').run(p.id, p.name, p.sort_order);
    }
    const categories = [
      { id: 'accountability-succession', pillar_id: 'strategy', name: '01. Accountability and Succession', sort_order: 1 },
      { id: 'risk-management', pillar_id: 'strategy', name: '02. Risk Management', sort_order: 2 },
      { id: 'conflict-resolution', pillar_id: 'strategy', name: '03. Conflict Resolution', sort_order: 3 },
      { id: 'maturity', pillar_id: 'strategy', name: '04. Maturity', sort_order: 4 },
      { id: 'relationships', pillar_id: 'people', name: '05. Relationships', sort_order: 1 },
      { id: 'learning', pillar_id: 'people', name: '06. Learning', sort_order: 2 },
      { id: 'wellness', pillar_id: 'people', name: '07. Wellness', sort_order: 3 },
      { id: 'investment', pillar_id: 'core-business', name: '08. Investment', sort_order: 1 },
      { id: 'philanthropy', pillar_id: 'core-business', name: '09. Philanthropy', sort_order: 2 },
      { id: 'tax-estate', pillar_id: 'core-business', name: '10. Tax and Estate', sort_order: 3 },
      { id: 'finance', pillar_id: 'operations', name: '11. Finance', sort_order: 1 },
      { id: 'it', pillar_id: 'operations', name: '12. IT', sort_order: 2 },
    ];
    for (const c of categories) {
      db.prepare('INSERT INTO task_categories (id, pillar_id, name, sort_order) VALUES (?, ?, ?, ?)').run(c.id, c.pillar_id, c.name, c.sort_order);
    }
  }
};
