const db = require('./db');

// Standard (non-introductory) Claude Sonnet 5 pricing, per token. Anthropic runs a
// temporary lower introductory rate through 2026-08-31; using the standard rate here
// keeps these estimates accurate for the long life of this feature rather than going
// stale the day the intro pricing ends.
const PRICE_PER_TOKEN = {
  input: 3.0 / 1e6,
  output: 15.0 / 1e6,
};

const MODEL = 'claude-sonnet-5';

// Never throws — a usage-logging failure should never break the request that
// triggered the underlying Claude call.
function logApiUsage({ callType, usage, opportunityId, userId }) {
  try {
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const costUsd = inputTokens * PRICE_PER_TOKEN.input + outputTokens * PRICE_PER_TOKEN.output;
    db.prepare(
      `INSERT INTO api_usage (at, call_type, model, input_tokens, output_tokens, estimated_cost_usd, opportunity_id, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(new Date().toISOString(), callType, MODEL, inputTokens, outputTokens, costUsd, opportunityId || null, userId || null);
  } catch (err) {
    console.error('Failed to log API usage:', err.message);
  }
}

function usageSummary() {
  const totals = db.prepare(
    `SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens,
            COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(estimated_cost_usd),0) AS costUsd
     FROM api_usage`
  ).get();
  const byCallType = db.prepare(
    `SELECT call_type AS callType, COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS inputTokens,
            COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(estimated_cost_usd),0) AS costUsd
     FROM api_usage GROUP BY call_type ORDER BY costUsd DESC`
  ).all();
  const recent = db.prepare('SELECT * FROM api_usage ORDER BY id DESC LIMIT 50').all().map((r) => ({
    id: r.id,
    at: r.at,
    callType: r.call_type,
    model: r.model,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    costUsd: r.estimated_cost_usd,
    opportunityId: r.opportunity_id,
    userId: r.user_id,
  }));
  return { totals, byCallType, recent };
}

module.exports = { logApiUsage, usageSummary };
