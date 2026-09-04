const { Agent, setGlobalDispatcher } = require('undici');

const MODEL = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Node's fetch (built on undici) defaults to a 300s headers timeout — the time allowed
// between sending the request and receiving the *start* of the response. A non-streaming
// call with a large max_tokens budget (extractStatement's 40000, for a dense multi-page
// credit card statement) can take longer than that to generate before the API sends
// anything back, since the whole JSON body arrives as one response — this isn't a slow
// network, it's a genuinely long generation. Verified empirically: a real 9-page
// statement hit UND_ERR_HEADERS_TIMEOUT at the default. Raised globally (affects every
// fetch call in this process, including the much shorter mailer.js/Graph calls, which
// finish in a couple seconds either way — a higher ceiling doesn't slow them down).
setGlobalDispatcher(new Agent({ headersTimeout: 20 * 60 * 1000, bodyTimeout: 20 * 60 * 1000 }));

class ClaudeNotConfiguredError extends Error {}

function apiKey() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ClaudeNotConfiguredError('ANTHROPIC_API_KEY is not set on the server');
  return key;
}

async function callClaude(body) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Claude API error ${resp.status}${text ? ': ' + text.slice(0, 300) : ''}`);
  }
  return resp.json();
}

function extractJson(data) {
  const raw = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!raw.trim()) throw new Error('Empty response from Claude');
  const match = raw.replace(/```json|```/gi, '').trim().match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Claude response');
  try {
    const parsed = JSON.parse(match[0]);
    // Claude occasionally emits a stray leading/trailing space in a top-level key (e.g.
    // " unresolvedItems" instead of "unresolvedItems"), which would otherwise silently
    // fail to match what the frontend reads and drop that section from the UI.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const cleaned = {};
      for (const [k, v] of Object.entries(parsed)) cleaned[k.trim()] = v;
      return cleaned;
    }
    return parsed;
  } catch (err) {
    if (data.stop_reason === 'max_tokens') {
      throw new Error('Claude response was cut off before finishing (max_tokens reached) — try again or raise max_tokens');
    }
    console.error('--- JSON parse failed. stop_reason:', data.stop_reason, '---');
    console.error(match[0]);
    console.error('--- parse error:', err.message, '---');
    throw err;
  }
}

async function research(type, opp) {
  const manager = opp.title;
  const assetClass = opp.assetClass;
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const systemPrompt = `You are conducting investment due diligence for a Canadian family office (Robinson Family Office, Ontario-based, ~CAD $30M AUM). Search the web for current, factual information and return a structured JSON object. Write for a family member with no finance background: short sentences, plain English, no jargon — if a technical or legal term is unavoidable, briefly explain it in the same sentence. Be concise and flag anything material. Today is ${today}.`;
  const findingsSpec = `Include only the 2-3 most material findings — skip minor or routine items.`;
  const prompts = {
    manager: `Search the web for current information about "${manager}" for investment due diligence. Find: litigation, regulatory actions, negative press, key-person departures, ownership changes, and any positive news (fund closes, awards, endorsements). Return ONLY valid JSON: {"summary":"1-2 short, plain-English sentences","overallSignal":"GREEN","findings":[{"type":"POSITIVE","headline":"short, plain-English headline","detail":"one plain-English sentence, no jargon","source":"source"}],"searchedAt":"${today}"}. ${findingsSpec} overallSignal: GREEN/AMBER/RED. type: FLAG/CAUTION/POSITIVE/NEUTRAL.`,
    industry: `Search the web for current industry dynamics for a ${assetClass} investment in "${manager}". Find: macro trends, valuation phenomena (e.g. sports franchise reset, PE secondary discounts, cap rate shifts), comparable fund performance, regulatory changes. Return ONLY valid JSON: {"summary":"1-2 short, plain-English sentences","overallSignal":"GREEN","findings":[{"type":"CAUTION","headline":"short, plain-English headline","detail":"one plain-English sentence, no jargon","source":"source"}],"searchedAt":"${today}"}. ${findingsSpec} overallSignal: GREEN/AMBER/RED. type: FLAG/CAUTION/POSITIVE/NEUTRAL.`,
    regulatory: `Search the web for Canadian regulatory and tax considerations for a Canadian family office LP investment in a ${assetClass} fund (${manager}). Find: CRA guidance, OSC/OSFI guidance, FAPI/anti-avoidance rules, Ontario-specific considerations. Return ONLY valid JSON: {"summary":"1-2 short, plain-English sentences","overallSignal":"GREEN","findings":[{"type":"NEUTRAL","headline":"short, plain-English headline","detail":"one plain-English sentence, no jargon","source":"source"}],"searchedAt":"${today}"}. ${findingsSpec} overallSignal: GREEN/AMBER/RED. type: FLAG/CAUTION/POSITIVE/NEUTRAL.`,
  };
  const data = await callClaude({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompts[type] }],
  });
  return { result: extractJson(data), usage: data.usage };
}

// Suggests which of the household's own expenditure categories a bank/credit-card
// transaction description belongs in — used when a manual substring/regex rule hasn't
// matched (the Household Expenditure app's "research this payee" action, see
// server/expenditure.js). A statement description is often an abbreviated or messy
// merchant name (franchise location codes, a payment-processor prefix like "SQ *" or
// "SP ", a city/province suffix), so this searches the web to identify what the payee
// actually is rather than pattern-matching the raw text alone — the same reasoning as
// the `research` function above, applied to a much smaller, cheaper lookup.
async function suggestCategory(description, categoryNames) {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const categoryList = categoryNames.map((c) => `"${c}"`).join(', ');
  const data = await callClaude({
    model: MODEL,
    max_tokens: 2048,
    system: `You are helping categorize a household's bank and credit-card transactions for a personal expenditure tracker. Today is ${today}.`,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content: `A bank/credit-card statement shows this transaction description exactly as printed: "${description}"

This is often an abbreviated or messy merchant name — it may include a city/province suffix, a franchise location code, or a payment-processor prefix (e.g. "SQ *", "SP "). Search the web if needed to identify what kind of business or payee this actually is.

Pick exactly ONE category from this list that best fits ongoing household spending at this payee: ${categoryList}. If you're not reasonably confident, or the payee is genuinely ambiguous (a generic-sounding e-Transfer to a person, a bare reference number, something you can't identify), use "Miscellaneous/Unknown" rather than guessing — a wrong specific category is worse than an honest "don't know."

Also suggest a short, stable substring from the description — the merchant name itself, not a location, date, or reference number — that would reliably match OTHER transactions from the same payee in future statements. For example, from "HERITAGE COOP ERIC GROC ERICKSON MB" suggest "HERITAGE COOP", not the whole string.

Return ONLY valid JSON, no markdown fences: {"payeeSummary":"one short sentence on what this business/payee actually is","category":"exact name from the list above","confidence":"high","reasoning":"one short sentence explaining the pick","suggestedPattern":"short stable substring"}. confidence must be exactly "high", "medium", or "low".`,
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

async function extractPdf(base64Data) {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const data = await callClaude({
    model: MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
          {
            type: 'text',
            text: `You are reading a Prime Quadrant investment research report. Today is ${today}. Extract all fields and return ONLY valid JSON (no markdown): {"title":"fund name","assetClass":"one of the 8 IPS classes","commitment":0,"currency":"USD","thesisSummary":"1-2 sentences","thesisRating":4,"returnTarget":"e.g. 12-16% net IRR","hasTrackRecord":true,"trackRecordDetail":"prior fund returns","teamSummary":"team overview","downsideScenarios":"2-4 sentence summary of the downside/risk scenarios PQ describes (valuation risk, key-person risk, downside return case, etc.)","esgProgramme":"Mature/Developing/Nascent/None","esgApproach":"Impact/Integrated/ESG Aware/Opportunistic/None","esgNote":"","oddRatings":{"governance":"Low","compliance":"Low","operations":"Low","alignment":"Low","reporting":"Low"},"oddGovernanceNote":"","feesSummary":"fees","termsSummary":"LP rights","lpRightsNote":"","isOffshore":false,"vehicleType":"Delaware LP","feesAboveNorm":false,"feesBelowNorm":false,"additionalContext":""}. For commitment: use 0 if not stated. For thesisRating: 1-5 based on clarity. For fees: compare to norms (PE: 2%/20%, Credit: 1.5%/15-20%, Real Assets: 1.5%/20%). Use null for missing strings, false for missing booleans.`,
          },
        ],
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

// Reads one household bank/credit-card statement PDF for the Household Expenditure app
// (see RFO_Expenditure_App_BuildSpec_v1.md) and returns every transaction as structured
// JSON, the same extract-with-a-document-block approach as extractPortfolioReport below.
// This sidesteps a real problem with these particular statements: RBC lays them out in
// two visual columns (the transaction table plus a sidebar of promotional/points/rate
// content), so a plain text-extraction library interleaves the two and produces garbage
// — Claude reads the layout visually instead of depending on text order, so this doesn't
// arise. accountType is 'chequing' or 'credit_card' since the two layouts differ
// (chequing: running balance, no separate post date; credit card: transaction + posting
// date, grouped by cardholder, paginated).
//
// Sign convention: amount is positive for money LEAVING the account (a chequing
// withdrawal, or a card purchase/debit) and negative for money ENTERING it (a chequing
// deposit, or a card payment/credit) — this makes "sum of amounts" line up directly with
// how much was spent, and lets the caller reconcile a chequing statement as
// openingBalance - sum(amounts) ≈ closingBalance, or a card statement as
// previousBalance + sum(amounts) ≈ newBalance, without trusting a separately-reported
// aggregate.
async function extractStatement(base64Data, accountType) {
  const isCard = accountType === 'credit_card';
  const summaryShape = isCard
    ? `"previousBalance":0,"newBalance":0,"paymentsAndCredits":0,"purchasesAndDebits":0,"interest":0,"fees":0`
    : `"openingBalance":0,"closingBalance":0,"totalDeposits":0,"totalWithdrawals":0`;
  const data = await callClaude({
    model: MODEL,
    // These statements can run several pages (the credit card statement paginates as
    // "1 OF 9" etc.) with a transaction on nearly every line. Verified empirically against
    // a real 9-page statement: 16000 (extractPortfolioReport's budget) was NOT enough and
    // got cut off mid-JSON (extractJson's stop_reason==='max_tokens' case) — a card
    // statement's transaction count plus the model's own thinking tokens can run well
    // past that, so this needs a much larger ceiling than any other extraction call here.
    max_tokens: 40000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
          {
            type: 'text',
            text: `This is a Royal Bank of Canada ${isCard ? 'Visa credit card' : 'chequing account'} statement. Extract every transaction and the statement's own summary totals.

For each transaction: the date (and, for a credit card, the separate posting date — chequing statements don't have one, use null), the description exactly as printed (if a description wraps onto a second line or has a reference code below it, join those into one description), and the signed amount using this convention: POSITIVE for money leaving the account (a withdrawal on chequing, a purchase/debit on the card), NEGATIVE for money entering it (a deposit on chequing, a payment/credit on the card). Do not skip any transaction, including ones on a continued/second page. A chequing statement occasionally shows a row with no date printed on it — that row continues the same date as the row above it; carry that date forward rather than leaving it null.

Also extract the statement's own reported summary totals so the caller can verify nothing was missed: ${summaryShape}. And the statement period: "periodStart" and "periodEnd" (the date range printed at the top, e.g. "From July 21, 2026 to August 21, 2026" or "STATEMENT FROM JUL 23 TO AUG 24, 2026").

Return ONLY valid JSON, no markdown fences, no extra prose: {"periodStart":"YYYY-MM-DD","periodEnd":"YYYY-MM-DD","summary":{${summaryShape}},"transactions":[{"date":"YYYY-MM-DD","postDate":${isCard ? '"YYYY-MM-DD"' : 'null'},"description":"text","amount":0}]}`,
          },
        ],
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

// Reads the family's periodic PQ investment report (the whole PDF, tens of pages) and
// pulls out the portfolio snapshot the app needs: total value, asset-class allocation,
// currency composition, every unfunded commitment (with its original book-value
// commitment size, not just what's left unfunded — needed for the 10/10/20/remaining
// capital-call pacing model), and a liquidity classification of the *liquid* holdings
// (cash through semi-liquid) that can actually be tapped to fund near-term needs. Private
// fund NAVs are deliberately left out of the liquidity tiers — they're captured as
// commitments/uses, not as a source of liquidity. Returned for admin review, never saved
// directly — see /api/admin/portfolio/extract.
async function extractPortfolioReport(base64Data) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
          {
            type: 'text',
            text: `This is a Prime Quadrant investment report for the Robinson Family Office. Extract a complete portfolio snapshot.

1. Report date ("as of" date on the cover or summary page) and total portfolio value in CAD.
2. Asset-class allocation as percentages of the total portfolio, for exactly these 8 classes: Cash, Fixed Income, Public Equity, Private Credit, Diversifying Strategies, Real Assets, Private Equity, Monetary Hedge. Use 0 for any class not present.
3. Currency composition (CAD/USD/EUR/GBP): percentage and CAD value of each.
4. From the "USD Position Detail" (or equivalent) pages: EVERY position with an unfunded commitment greater than zero. For each, give the fund name exactly as printed, its IPS asset class (one of the 8 above), the currency it's committed in, the total/original commitment (book value — the whole amount ever committed, not just what's called), the amount called/invested to date, and the amount still unfunded. Do not skip any position with unfunded > 0.
5. From the "Liquidity Detail" (or equivalent) pages: classify every LIQUID holding (i.e. everything except the illiquid private closed-end funds already captured in unfunded commitments above — private equity, private credit drawdown funds, real assets, etc. do NOT belong here) into exactly these 4 tiers: "Cash" (cash, HISA, cash-management strategies), "Highly Liquid" (publicly traded ETFs/equities, liquid public-market funds, monthly-liquidity income funds), "Medium Liquidity" (semi-liquid credit/hedge fund vehicles, typically quarterly redemption or similar), "Low Liquidity" (semi-liquid vehicles with longer lock-ups/gates than Medium, but still redeemable — not the illiquid drawdown funds). Use the report's own liquidity tier labels as a guide for which of my 4 buckets each holding belongs in. For each holding give its name, dollar amount, and currency.

Return ONLY valid JSON, no markdown fences, no extra prose:
{"asOf":"MM-DD-YYYY","totalCAD":0,"alloc":{"Cash":0,"Fixed Income":0,"Public Equity":0,"Private Credit":0,"Diversifying Strategies":0,"Real Assets":0,"Private Equity":0,"Monetary Hedge":0},"fx":{"CAD":{"pct":0,"val":0},"USD":{"pct":0,"val":0},"EUR":{"pct":0,"val":0},"GBP":{"pct":0,"val":0}},"unfunded":[{"fund":"name","class":"one of the 8 classes","currency":"USD","commitment":0,"called":0,"unfunded":0}],"liquidityTiers":[{"tier":"Cash","items":[{"name":"holding name","amount":0,"currency":"CAD"}]},{"tier":"Highly Liquid","items":[]},{"tier":"Medium Liquidity","items":[]},{"tier":"Low Liquidity","items":[]}],"notes":"anything unclear, ambiguous, or that needed a judgment call"}`,
          },
        ],
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

// Reads the family's periodic "Yield Generating Investments and Projected Income" report —
// a short table of income-producing positions — so recurring distributions can be added as
// a liquidity source alongside the asset-tier waterfall in A4. Registered-account holdings
// are flagged separately (per the report's own yellow-highlight convention) since that
// income isn't freely available without tax consequences and shouldn't be counted as
// liquidity on tap for a capital call. Returned for admin review, never saved directly.
async function extractIncomeReport(base64Data) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
          {
            type: 'text',
            text: `This is a Prime Quadrant "Yield Generating Investments and Projected Income" report for the Robinson Family Office. Extract the "as of" date and every row from the income table(s) — do not skip any.

For each position: name, currency, market value, estimated yield (as a percentage), estimated annual distributions, distribution frequency, and whether it's flagged as held in a registered account (the report highlights these — registered-account income is not freely available without tax implications, so flag it distinctly). Note the report's own currency subtotal groupings (e.g. "CAD Investments" vs "USD Investments" sections) by recording each position's native currency.

Return ONLY valid JSON, no markdown fences, no extra prose:
{"asOf":"MM-DD-YYYY","positions":[{"name":"position name","currency":"CAD","marketValue":0,"yieldPct":0,"annualDistribution":0,"frequency":"Monthly","isRegistered":false}],"notes":"anything unclear or that needed a judgment call"}`,
          },
        ],
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

// A follow-up document for an opportunity already under review — a side letter, a fee or
// terms amendment, updated track record, additional call notes, etc. — rather than the
// full PQ research report handled by extractPdf. Same field shape, but the model is told
// to leave anything this specific document doesn't address as null rather than guessing,
// so the caller can diff against the opportunity's current pqData and show the reviewer
// only what actually changed. Returned for admin/initiator review, never saved directly.
async function extractOpportunityDocument(base64Data, opportunityTitle) {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const data = await callClaude({
    model: MODEL,
    // A follow-up document can itself be a full research report (this field set matches
    // extractPdf's), and unlike a brand-new upload, this one also carries a documentSummary
    // plus explicit nulls for every unaddressed field — comfortably larger than extractPdf's
    // 3000-token budget for a dense report. See extractPortfolioReport's history: the same
    // failure mode (stop_reason: 'max_tokens', truncated JSON) showed up there first.
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
          {
            type: 'text',
            text: `Today is ${today}. This document relates to an investment opportunity already under due diligence review${opportunityTitle ? ` ("${opportunityTitle}")` : ''}. It may be the full PQ research report, or it may be a supplementary document — a side letter, a fee/terms amendment, updated track record data, additional call/meeting notes, a legal opinion, etc.

First, write a one-sentence plain-English summary of what this specific document is (documentSummary). Then extract ONLY the fields below that THIS document actually addresses or updates — use null for any field this document doesn't speak to. Do not guess or carry over values from general knowledge; a document that's purely a side letter about fee terms, for example, should leave everything except the fee/terms fields as null. IMPORTANT: only fill in "title" if the fund/manager's actual legal name has changed — never use this document's own heading or subject line (e.g. "Side Letter — Fee Amendment") as the title; leave it null in every other case, since a wrong value here would rename the opportunity.

Several fields fill a fixed-shape UI control and MUST use exactly the format shown, never a descriptive sentence — leave any of these null rather than writing prose into them: "commitment" is a plain number with no currency symbol or words (e.g. 100000, not "USD 100,000 minimum investment"); "thesisRating" is a bare integer 1-5; "assetClass" must exactly match one of the 8 IPS classes (Cash, Fixed Income, Public Equity, Private Equity, Private Credit, Diversifying Strategies, Real Assets, Monetary Hedge); "esgProgramme" must be exactly one of Mature/Developing/Nascent/None; "esgApproach" must be exactly one of Impact/Integrated/ESG Aware/Opportunistic/None; each oddRatings dimension must be exactly Low/Medium/High. Narrative detail that doesn't fit one of those exact values belongs in the corresponding free-text field instead (e.g. termsSummary, esgNote) or in additionalContext, not stuffed into the constrained field.

Return ONLY valid JSON (no markdown fences): {"documentSummary":"one plain-English sentence describing what this document is","title":null,"assetClass":null,"commitment":null,"currency":null,"thesisSummary":null,"thesisRating":null,"returnTarget":null,"hasTrackRecord":null,"trackRecordDetail":null,"teamSummary":null,"downsideScenarios":null,"esgProgramme":null,"esgApproach":null,"esgNote":null,"oddRatings":{"governance":null,"compliance":null,"operations":null,"alignment":null,"reporting":null},"oddGovernanceNote":null,"feesSummary":null,"termsSummary":null,"lpRightsNote":null,"isOffshore":null,"vehicleType":null,"feesAboveNorm":null,"feesBelowNorm":null,"additionalContext":null}`,
          },
        ],
      },
    ],
  });
  return { result: extractJson(data), usage: data.usage };
}

// Synthesizes IC member checklist responses (whatever has been submitted so far — the
// caller may trigger this before everyone has responded) into a governance-style summary,
// per the original build spec's "Claude's Recommendation" logic (system prompt below).
async function generateReport({ opp, questions, autoAnswers, members, totalCAD }) {
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  const aumM = totalCAD ? Math.round(totalCAD / 1e6) : 30;
  const systemPrompt = `You are a governance analyst supporting the Robinson Family Office Investment Committee (IC). The IC is a Canadian single-family office with assets of approximately CAD $${aumM}M. The family's investment advisor is Prime Quadrant (PQ). The IC reviews PQ's recommendations and independently assesses alignment with the family's Investment Policy Statement (IPS) and values before committing.

Your role is to synthesise the IC members' individual checklist responses and PQ's research into a concise, actionable recommendation. You are analytical and direct. You highlight areas of consensus, flag material divergences between members, and identify any governance or compliance items that must be resolved before commitment. Be terse throughout — short sentences, no padding, no restating a point already made elsewhere in the report.

You are NOT replacing the IC's decision. You are providing structured analytical support. Some IC members may not have submitted their review yet — the caller may be checking in early. Work only with what has actually been submitted or entered so far, and note clearly who is still outstanding rather than assuming their view.

Today is ${today}.`;

  const questionText = (id) => {
    const q = (questions || []).find((q) => q.id === id);
    return q ? q.text : id;
  };

  const memberBlocks = (members || [])
    .map((m) => {
      const hasAnything = m.submitted || Object.keys(m.responses || {}).length > 0 || m.recommendation;
      if (!hasAnything) return `${m.name}: No response started yet.`;
      const answers = Object.entries(m.responses || {})
        .map(([qid, r]) => `  - ${questionText(qid)}\n    Answer: ${r.v ?? '(no answer)'}${r.c ? `\n    Comment: ${r.c}` : ''}`)
        .join('\n');
      return `${m.name} (${m.submitted ? 'SUBMITTED' : 'IN PROGRESS — not yet submitted'}):
  Overall recommendation: ${m.recommendation || '(not yet selected)'}
  Overall comments: ${m.overall || '(none)'}
  Follow-up items: ${(m.followUp || []).length ? m.followUp.join('; ') : 'None'}
  Checklist answers:
${answers || '  (none yet)'}`;
    })
    .join('\n\n');

  const autoAnswerBlock = Object.entries(autoAnswers || {})
    .map(([qid, a]) => `- ${questionText(qid)}: ${a.display ?? a.value}${a.rationale ? ` — ${String(a.rationale).split('\n')[0]}` : ''}`)
    .join('\n');

  const userPrompt = `OPPORTUNITY: ${opp.title}
Asset class: ${opp.assetClass}
Proposed commitment: ${opp.currency} ${Number(opp.commitment || 0).toLocaleString()}
PQ summary: ${opp.pqSummary || '(none)'}

CLAUDE / DATA-DRIVEN ANSWERS (established context — not a member's personal judgment):
${autoAnswerBlock || '(none)'}

IC MEMBER RESPONSES:
${memberBlocks || '(no members)'}

Format your response as a JSON object with exactly these keys, in this order: {"executiveSummary":"2 short sentences","recommendation":"APPROVE" | "CONDITIONAL APPROVAL" | "DECLINE" | "DEFER PENDING INFORMATION","rationale":"1 short paragraph, 3-4 sentences max","keyStrengths":["short bullet, max 3", ...],"keyRisks":["short bullet, max 3", ...],"memberSentiment":[{"member":"name","sentence":"one short sentence"}],"unresolvedItems":["short item", ...],"requiredActions":["short action", ...]}. Use empty arrays where there's nothing to list. Every key listed must be present in your output, even if brief — never omit a key. Return ONLY valid JSON, no markdown formatting.`;

  const data = await callClaude({
    model: MODEL,
    max_tokens: 6000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return { result: extractJson(data), usage: data.usage };
}

module.exports = { research, extractPdf, extractOpportunityDocument, extractPortfolioReport, extractIncomeReport, extractStatement, suggestCategory, generateReport, ClaudeNotConfiguredError };
