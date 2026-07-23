const MODEL = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

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

module.exports = { research, extractPdf, generateReport, ClaudeNotConfiguredError };
