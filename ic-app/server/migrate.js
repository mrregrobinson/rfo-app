const fs = require('node:fs');
const path = require('node:path');

// Each file in migrations/ exports a function(db) and is applied at most once,
// tracked by filename in schema_migrations. Files are pre-existing idempotent
// guards (IF NOT EXISTS / column-existence checks), so re-running this against
// a database that already has a given migration's effect applied is a safe no-op
// — that's what lets this framework adopt an already-migrated production database
// without a special first-run path.
function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.js')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const migration = require(path.join(migrationsDir, file));
    migration(db);
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    console.log(`Applied migration: ${file}`);
  }
}

module.exports = { runMigrations };
