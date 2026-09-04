// Shared daily FX-rate lookup, used by both the Household Expenditure app and the Due
// Diligence app's currency conversions (family planning activities, unfunded
// commitments, liquidity tiers, income positions) — replacing the single hardcoded
// ACTIVITY_FX table those used to share in public/finance.js.
//
// Source: the Bank of Canada Valet API (free, public, no key —
// https://www.bankofcanada.ca/valet-api-how-to/), the authoritative CAD rate source.
// Rates are resolved once per (date, pair) and cached in fx_rates (see migration 021)
// so a historical figure never silently changes later and repeated lookups for the same
// date don't re-hit the network. Callers should resolve a rate once, at the point a
// foreign-currency amount is entered/imported, and persist it — not re-look-up live on
// every read.
const db = require('./db');

const VALET_SERIES = { USDCAD: 'FXUSDCAD', EURCAD: 'FXEURCAD', GBPCAD: 'FXGBPCAD' };

function cacheGet(dateStr, pair) {
  return db.prepare('SELECT rate FROM fx_rates WHERE requested_date = ? AND pair = ?').get(dateStr, pair);
}

function cachePut(dateStr, pair, rate, rateDate, source) {
  db.prepare(
    `INSERT INTO fx_rates (requested_date, pair, rate, rate_date, source, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(requested_date, pair) DO UPDATE SET
       rate = excluded.rate, rate_date = excluded.rate_date, source = excluded.source, fetched_at = excluded.fetched_at`
  ).run(dateStr, pair, rate, rateDate, source, new Date().toISOString());
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// The Bank of Canada only publishes on business days, so a weekend/holiday date has no
// observation for it. Query a short window ending at the requested date and take the
// last (most recent) observation on or before it — the standard FX convention for a
// non-trading day — rather than a single-date query that would come back empty.
async function fetchFromValet(dateStr, pair) {
  const series = VALET_SERIES[pair];
  if (!series) throw new Error(`Unsupported FX pair: ${pair}`);
  const end = new Date(`${dateStr}T00:00:00Z`);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const url = `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${fmtDate(start)}&end_date=${fmtDate(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bank of Canada Valet API error ${res.status}`);
  const data = await res.json();
  const observations = (data.observations || []).filter((o) => o[series] && o[series].v != null);
  if (observations.length === 0) throw new Error(`No ${series} observations found in the week ending ${dateStr}`);
  const latest = observations[observations.length - 1];
  return { rate: Number(latest[series].v), rateDate: latest.d };
}

// Resolves the CAD rate for `pair` (e.g. 'USDCAD') on `dateStr` (YYYY-MM-DD): local cache
// first, then the Valet API. If the API call fails (network blip, outage), falls back to
// the most recent rate already cached for that pair rather than blocking the caller —
// financial ingestion/activity-saving shouldn't hard-fail on a transient network issue —
// but the fallback is itself cached under a distinct source so it's easy to spot and
// re-resolve later once the API is reachable again.
async function getDailyRate(dateStr, pair = 'USDCAD') {
  if (pair === 'CADCAD') return 1;
  const cached = cacheGet(dateStr, pair);
  if (cached) return cached.rate;
  try {
    const { rate, rateDate } = await fetchFromValet(dateStr, pair);
    cachePut(dateStr, pair, rate, rateDate, 'boc-valet');
    return rate;
  } catch (err) {
    const fallback = db.prepare('SELECT rate FROM fx_rates WHERE pair = ? ORDER BY requested_date DESC LIMIT 1').get(pair);
    if (!fallback) throw err;
    console.error(`FX lookup failed for ${pair} on ${dateStr} (${err.message}); using most recently cached rate as a fallback.`);
    cachePut(dateStr, pair, fallback.rate, dateStr, 'fallback-stale-cache');
    return fallback.rate;
  }
}

module.exports = { getDailyRate };
