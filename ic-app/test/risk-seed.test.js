// Regression guard for the risk-register seed. The seed lives in server/seed.js's
// ensureSeeded() (NOT a migration) precisely because migrations run before any user
// exists and the baseline assessment needs a real user to attribute to. This test
// reproduces a fresh install: migrate, then seed, and checks the register comes up
// fully populated and the seed is idempotent.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');

const tmpDbPath = path.join(os.tmpdir(), `ic-riskseed-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db'); // runs migrations against the throwaway db
const { ensureSeeded } = require('../server/seed');
const seedData = require('../server/risk-seed-data');

after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = tmpDbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe('risk register seeding', () => {
  test('migrations alone create the tables but seed nothing', () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_categories').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_assessments').get().n, 0);
  });

  test('ensureSeeded() populates the full v5 register, attributed to a real user', () => {
    ensureSeeded(); // also creates the 4 users, then seeds the register

    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_domains').get().n, seedData.DOMAINS.length);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_scale').get().n, seedData.SCALE.length);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_categories').get().n, 14);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_assessments').get().n, 14);

    const totalActions = seedData.CATEGORIES.reduce((s, c) => s + c.actions.length, 0);
    const totalMits = seedData.CATEGORIES.reduce((s, c) => s + c.mitigations.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_actions').get().n, totalActions);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_mitigations').get().n, totalMits);

    // every baseline assessment points at an existing user (the bug being guarded against)
    const orphan = db.prepare(
      'SELECT COUNT(*) AS n FROM risk_assessments a LEFT JOIN users u ON u.id = a.assessed_by WHERE u.id IS NULL'
    ).get().n;
    assert.equal(orphan, 0);

    // notes column carried the v5 "Dalio Framework Note" content
    const r1 = db.prepare("SELECT notes FROM risk_categories WHERE id = 'risk-01'").get();
    assert.match(r1.notes, /Dalio/);
  });

  test('ensureSeeded() is idempotent — a second call adds nothing', () => {
    ensureSeeded();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_categories').get().n, 14);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM risk_assessments').get().n, 14);
  });
});
