// Uses an isolated throwaway database (see server/db.js's IC_DB_PATH) so these tests
// never touch the family's real data/ic.db, and mocks global.fetch so no test hits the
// real Bank of Canada Valet API.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

const tmpDbPath = path.join(os.tmpdir(), `ic-fx-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.IC_DB_PATH = tmpDbPath;

const db = require('../server/db');
const fx = require('../server/fx');

function valetResponse(series, observations) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ observations: observations.map(([d, v]) => ({ d, [series]: { v: String(v) } })) }),
  };
}

after(() => {
  db.close(); // release the file handle first — Windows refuses to unlink an open file
  for (const suffix of ['', '-wal', '-shm']) {
    const p = tmpDbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

describe('getDailyRate', () => {
  test('CADCAD is always 1, with no network call', async () => {
    const fetchMock = mock.method(global, 'fetch', async () => { throw new Error('should not be called'); });
    try {
      assert.equal(await fx.getDailyRate('2026-08-24', 'CADCAD'), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('fetches and caches the observation for a business day', async () => {
    const fetchMock = mock.method(global, 'fetch', async () =>
      valetResponse('FXUSDCAD', [['2026-08-24', 1.379]])
    );
    try {
      const rate = await fx.getDailyRate('2026-08-24', 'USDCAD');
      assert.equal(rate, 1.379);
      assert.equal(fetchMock.mock.calls.length, 1);

      // Second call for the same date/pair should hit the cache, not the network.
      const rate2 = await fx.getDailyRate('2026-08-24', 'USDCAD');
      assert.equal(rate2, 1.379);
      assert.equal(fetchMock.mock.calls.length, 1, 'should not re-fetch a cached date');
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('a weekend/holiday date falls back to the most recent prior observation in the window', async () => {
    // Requested date (a Sunday) has no observation; the last one in the returned window
    // (the preceding Friday) should be used instead.
    const fetchMock = mock.method(global, 'fetch', async () =>
      valetResponse('FXUSDCAD', [
        ['2026-08-21', 1.372],
        ['2026-08-22', 1.375],
      ])
    );
    try {
      const rate = await fx.getDailyRate('2026-08-23', 'USDCAD');
      assert.equal(rate, 1.375, 'should use the most recent observation on or before the requested date');
    } finally {
      fetchMock.mock.restore();
    }
  });

  test('falls back to the most recent cached rate if the API call fails', async () => {
    // Prime the cache with a known-good rate for an earlier date.
    const primeMock = mock.method(global, 'fetch', async () => valetResponse('FXEURCAD', [['2026-08-01', 1.55]]));
    await fx.getDailyRate('2026-08-01', 'EURCAD');
    primeMock.mock.restore();

    const failMock = mock.method(global, 'fetch', async () => ({ ok: false, status: 503 }));
    try {
      const rate = await fx.getDailyRate('2026-09-04', 'EURCAD');
      assert.equal(rate, 1.55, 'should fall back to the most recently cached rate for this pair');
    } finally {
      failMock.mock.restore();
    }
  });

  test('throws when the API fails and there is no cached rate to fall back to', async () => {
    const failMock = mock.method(global, 'fetch', async () => ({ ok: false, status: 503 }));
    try {
      await assert.rejects(() => fx.getDailyRate('2026-09-04', 'GBPCAD'));
    } finally {
      failMock.mock.restore();
    }
  });

  test('rejects an unsupported pair', async () => {
    await assert.rejects(() => fx.getDailyRate('2026-09-04', 'JPYCAD'));
  });
});
