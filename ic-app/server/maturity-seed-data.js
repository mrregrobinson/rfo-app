// Reconciled initial seed content for the Maturity Assessment module.
// See RFO_Maturity_App_BuildSpec_v1 (§5.7). Applied by server/seed.js's ensureSeeded()
// via seedMaturity() — NOT a migration (the reference round's member scores need a real
// user to attribute to, and migrations run before any user exists).
//
// Transcribed from the source document in the repo family-office folder:
//   Planning and Governance/2026/Governance and Scope of Services/
//     Appendix B - Maturity Scorecard.xlsx   (sheet "Maturity Scorecard", rows 2..17;
//     level descriptors are columns C..G, member scores are columns H..K = Reg/Ross/Lucas/SD)
//
// Spreadsheet typos fixed on transcription (flagged inline with SOURCE TYPO:):
//   - "Strategfic" -> "Strategic" (Strategy, level 4)
//   - "priortities" -> "priorities" (Strategy, level 2)
//   - double spaces normalised throughout ("Finance,  Admin" -> "Finance, Admin", etc.)

// ---- 5 service categories ----
const GROUPS = [
  { id: 'strategic-services', name: 'Strategic Services', sort_order: 1 },
  { id: 'people', name: 'People', sort_order: 2 },
  { id: 'investment-services', name: 'Investment Services', sort_order: 3 },
  { id: 'legacy-services', name: 'Legacy Services', sort_order: 4 },
  { id: 'operations', name: 'Operations', sort_order: 5 },
];

// ---- the 5 maturity levels (global labels; per-service descriptors below) ----
const LEVEL_LABELS = [
  { level: 1, name: 'Ad Hoc', blurb: 'No documented approach; handled case by case by one or two people.' },
  { level: 2, name: 'Emerging', blurb: 'First attempts at structure — partial, inconsistent, often advisor-led.' },
  { level: 3, name: 'Established', blurb: 'A documented approach is in place and generally followed; regular reviews.' },
  { level: 4, name: 'Institutionalized', blurb: 'Embedded in systems and governance — disciplined, monitored, coordinated.' },
  { level: 5, name: 'Leading Practice', blurb: 'Benchmarked against peers, continuously improved, integrated across generations.' },
];

// ---- 16 services, each with its 5 level descriptors (Appendix B columns C..G) ----
// levels: [ level 1 (Ad Hoc) ... level 5 (Leading Practice) ]
const SERVICES = [
  {
    id: 'svc-01', groupId: 'strategic-services', number: 1, name: 'Strategy',
    levels: [
      'No documented vision, values, or priorities.',
      'Initial attempts at documenting strategic plans — vision, values, priorities.', // SOURCE TYPO: "priortities"
      'Family mission, vision and shared values documented.',
      'Strategic plans in place and in use. Multi-generational planning fully integrated.', // SOURCE TYPO: "Strategfic"
      'Regular confirmation that the family is living the shared values and prioritising the family priorities.',
    ],
  },
  {
    id: 'svc-02', groupId: 'strategic-services', number: 2, name: 'Governance',
    levels: [
      'No formal governance. Decisions made informally by one or two family members. No documented roles or processes.',
      'Family council or advisory board formed, but role is unclear. Decisions are still dominated by a few members. Family meetings irregular.',
      'Governance bodies (board, council, committees) defined with charters. Roles and responsibilities assigned. Draft succession plan in place. Annual family meetings occur.',
      'Governance bodies and accountabilities functioning as defined. Policies for conflict resolution exist and are followed. Next generation involved appropriately.',
      'Governance benchmarked against peers. Ongoing governance training and development. Next-gen leadership pipelines established. Governance continuously improved.',
    ],
  },
  {
    id: 'svc-03', groupId: 'strategic-services', number: 3, name: 'Risk Management',
    levels: [
      'Risks handled case-by-case. Minimal insurance. No monitoring.',
      'Basic and partial insurance coverage in place. Compliance logs started. Basic legal review of contracts. Issues tracked manually.',
      'Risk register maintained and updated. Key risks discussed regularly with family. Policies for approvals and authorisations in place.',
      'Enterprise risk management framework. Independent audit and compliance reviews. Scenario / stress testing used.',
      'Continuous monitoring of risks with technology. Global regulatory alignment. Horizon scanning for emerging risks (e.g. AI, ESG). Risk culture embedded across family and staff.',
    ],
  },
  {
    id: 'svc-04', groupId: 'people', number: 4, name: 'Family Relationships',
    levels: [
      'Minimal communication. Tensions unmanaged. Family meetings rare or absent.',
      'Occasional family gatherings. Basic efforts at cohesion (e.g. holiday meetings). Disputes managed informally.',
      'Structured family meetings with agendas. Shared values / mission documented. Conflict resolution mechanisms introduced.',
      'Annual retreats, family education, facilitated discussions. Next generation actively included in discussions.',
      'Strong culture of trust. Multi-gen cohesion programmes. Family values integrated in practice. Proactive communication fosters resilience. Family culture nurtured intentionally.',
    ],
  },
  {
    id: 'svc-05', groupId: 'people', number: 5, name: 'Develop Capabilities',
    levels: [
      'No intentional development of family capabilities. Knowledge and decision-making concentrated in a few individuals.',
      'Some informal learning through observation or advisor interactions. Limited exposure to governance, investing, or stewardship topics.',
      'Intentional education for family members on core topics (governance, investments, wealth stewardship). External courses or seminars used selectively.',
      'Structured development pathways for different generations. Regular education sessions, shared learning experiences, and use of external experts.',
      'Family viewed as a learning system. Continuous development of leadership, decision-making, and stewardship capabilities across generations. Learning goals reviewed regularly and aligned with succession roles.',
    ],
  },
  {
    id: 'svc-06', groupId: 'people', number: 6, name: 'Family Wellness',
    levels: [
      'Wellness left to individuals. No consideration in family-office policies.',
      'Some ad hoc wellness support (insurance coverage, gym stipends, family retreats).',
      'Intentional focus on wellbeing through education, benefits, or family discussions. Recognition of stress and burnout risks.',
      'Holistic wellness approach addressing physical, mental, emotional, and financial wellbeing. Proactive programmes and expert support.',
      'Wellness embedded as a strategic priority. Preventive, intergenerational approach supporting long-term health, resilience, and balance.',
    ],
  },
  {
    id: 'svc-07', groupId: 'investment-services', number: 7, name: 'Passive Investment',
    levels: [
      'Investments made opportunistically, often based on relationships or intuition. Limited diversification strategy. Performance rarely tracked or documented.',
      'Draft investment policy and basic diversification. Reporting available but irregular.',
      'Formal investment policy guides decisions. Diversified portfolio. Regular performance monitoring and reviews.',
      'Risk-adjusted benchmarks used. Disciplined rebalancing process. Clear oversight and decision framework.',
      'Sophisticated portfolio construction and analytics. Peer benchmarking and continuous refinement of strategy.',
    ],
  },
  {
    id: 'svc-08', groupId: 'investment-services', number: 8, name: 'Direct Investment',
    levels: [
      'Direct investments pursued opportunistically. Limited due diligence or governance.',
      'Selective direct investments with some advisor input. Inconsistent evaluation process.',
      'Structured due diligence and approval process. Clear ownership and monitoring responsibilities.',
      'Portfolio approach to direct investments. Risk management, reporting, and exit planning standardised.',
      'Institutional-quality direct-investment platform with disciplined sourcing, governance, and performance evaluation.',
    ],
  },
  {
    id: 'svc-09', groupId: 'legacy-services', number: 9, name: 'Philanthropy',
    levels: [
      'Giving is reactive, based on requests or personal passion. No central tracking.',
      'Foundation or donor-advised fund established. Some record-keeping. Limited alignment with family values.',
      'Philanthropy strategy documented. Giving aligned with family values. Annual reporting of donations.',
      'Outcomes and impact measured. Next generation actively engaged in giving. Strategy reviewed regularly. Partnerships with other organisations.',
      'Philanthropy recognised as a core family activity. Thoughtful, collaborative, and transparent impact leadership. Family demonstrates leadership in community.',
    ],
  },
  {
    id: 'svc-10', groupId: 'legacy-services', number: 10, name: 'Estate Planning',
    levels: [
      'Basic wills exist, outdated. No unified estate plan. Heirs not informed.',
      'Trusts or foundations created but uncoordinated. Estate documents updated irregularly. Minimal next-gen education.',
      'Integrated estate plan across jurisdictions. Coordinated structures for philanthropy and assets. Succession milestones identified.',
      'Tax optimisation strategies deployed. Next generation engaged in ownership or philanthropy. Advisors coordinated. Succession plan actively monitored.',
      'Comprehensive multi-gen wealth and legacy strategy. Next-gen actively leading in governance or philanthropy. Plan regularly updated to reflect global and regulatory changes.',
    ],
  },
  {
    id: 'svc-11', groupId: 'legacy-services', number: 11, name: 'Tax Planning',
    levels: [
      'Tax matters handled reactively and transaction-by-transaction.',
      'Basic tax planning with external advisors. Limited coordination.',
      'Coordinated tax strategy aligned with investments and estate planning.',
      'Advanced planning and monitoring across jurisdictions. Risks proactively managed.',
      'Highly proactive and strategic tax management integrated into all major decisions.',
    ],
  },
  {
    id: 'svc-12', groupId: 'operations', number: 12, name: 'Finance, Admin and Compliance', // SOURCE TYPO: "Finance,  Admin"
    levels: [
      'Reliance on Excel and email. Processes undocumented. No separation of duties. Paper records common.',
      'Accounting software in place. Some outsourced providers, chosen opportunistically. Processes partially documented. Reporting inconsistent.',
      'Standard operating procedures (SOPs) documented. Outsourcing partners vetted and monitored. Consolidated financial reporting available. Back-office efficiency established.',
      'Secure technology platform integrates accounting, investments, and reporting. KPI dashboards in use. Vendor risk reviewed annually.',
      'Fully digital, automated workflows. AI or data analytics used for forecasting. Real-time consolidated reporting across entities. Continuous improvement of operations.',
    ],
  },
  {
    id: 'svc-13', groupId: 'operations', number: 13, name: 'IT Management and Cybersecurity',
    levels: [
      'Personal devices used. No cyber protocols. Outsourced IT informal.',
      'Basic firewall / antivirus. Passwords inconsistent. Backups irregular.',
      'MFA and backup policies enforced. Staff cyber awareness training. IT policies documented.',
      'IT strategy formalised. Annual penetration tests. Incident response plan. Dedicated IT / cyber resource.',
      'Zero-trust security, 24/7 monitoring, phishing simulations, cyber risk integrated into governance reviews.',
    ],
  },
  {
    id: 'svc-14', groupId: 'operations', number: 14, name: 'Legal',
    levels: [
      'Legal issues addressed only when problems arise.',
      'External counsel used reactively. Limited standardisation.',
      'Standard contracts and legal oversight established.',
      'Proactive legal risk management and regular reviews.',
      'Strategic legal governance aligned with family objectives and best practices.',
    ],
  },
  {
    id: 'svc-15', groupId: 'operations', number: 15, name: 'External Relationships',
    levels: [
      'Advisor relationships informal and transactional.',
      'Core advisors identified but engagement inconsistent.',
      'Trusted advisor network with defined roles and regular interaction.',
      'Strategic partnerships actively managed and periodically reviewed.',
      'Deep, long-term relationships with best-in-class advisors and a well-functioning inter-relationship between advisors.',
    ],
  },
  {
    id: 'svc-16', groupId: 'operations', number: 16, name: 'External Communication',
    levels: [
      'No intentional external communication. Reactive responses only.',
      'Limited, informal communication coordinated by individuals.',
      'Clear messaging and protocols for external communication.',
      'Proactive, consistent communication aligned with family values and objectives.',
      'Highly intentional external presence supporting reputation, privacy, and influence.',
    ],
  },
];

// ---- starter question set (3–5 per service, admin-editable; §5.3) ----
// Derived from the level descriptors: one "which level fits" pick plus three
// agreement statements that are true at higher levels and false at lower ones.
function questionsForService(svc) {
  return [
    {
      prompt: `Which of the five descriptions best matches where the family office is today on ${svc.name}?`,
      help_text: 'Pick the single description that fits best overall, even if some details differ.',
      response_kind: 'level_pick', weight: 2,
    },
    {
      prompt: `There is a documented, agreed approach to ${svc.name} that is actually followed in practice.`,
      help_text: '', response_kind: 'scale_1_5', weight: 1,
    },
    {
      prompt: `${svc.name} is embedded in our systems and governance — it is disciplined, monitored, and coordinated with the areas it touches.`,
      help_text: '', response_kind: 'scale_1_5', weight: 1,
    },
    {
      prompt: `We benchmark ${svc.name} against peer family offices and improve it deliberately over time.`,
      help_text: '', response_kind: 'scale_1_5', weight: 1,
    },
  ];
}

// ---- Capital Consciousness ladder (Mo Lidsky, Arc of Capital Consciousness; §5.8) ----
const CC_LEVELS = [
  { level: 1, name: 'Instinctive', tagline: 'Capital as survival',
    description: 'Capital is primal — about safety, control and not losing. Fear is the primary driver and a powerful editor that filters out anything that does not feel immediately protective. Decisions are fast, reactive, and heavily weighted to loss avoidance.' },
  { level: 2, name: 'Competitive', tagline: 'Capital as accumulation',
    description: 'Intentional and disciplined, but framed narrowly. Returns, fees, taxes and peer comparison dominate. Each decision is judged in its own bucket, so larger invisible costs compound unexamined.' },
  { level: 3, name: 'Protective', tagline: 'Capital as a shield',
    description: 'The first level where capital is genuinely held in service of others. Trusts, estate plans and governance structures are acts of care — but structures often get built before the conversations that give them meaning, and preparing people lags protecting wealth.' },
  { level: 4, name: 'Integrative', tagline: 'Capital as a system',
    description: 'Capital is seen and coordinated as one whole — investments, tax, estate, insurance and liquidity aligned rather than siloed, with someone accountable for the whole. The question of purpose becomes audible for the first time.' },
  { level: 5, name: 'Reflective', tagline: 'Capital as a mirror',
    description: 'The questions change from "is it optimal?" to "is this consistent with who we are? what is enough?" Capital is examined against stated values, and misalignments are made into deliberate choices rather than hidden ones.' },
  { level: 6, name: 'Generative', tagline: 'Capital as a force',
    description: 'Capital is understood as a lever for outcomes in the world beyond the family, guided by an explicit theory of change and a real willingness to measure whether the giving is working.' },
  { level: 7, name: 'Transcendent', tagline: 'Capital as freedom',
    description: 'Wealth is still managed with full rigour, but it no longer occupies the centre of gravity or defines identity. The grip loosens; optimisation continues without attachment to it.' },
];

const CC_DIMENSIONS = [
  { id: 'overall', name: 'Overall', sort_order: 1, service_ids: ['svc-01', 'svc-04', 'svc-05'] },
  { id: 'investment', name: 'Investment Decisions', sort_order: 2, service_ids: ['svc-07', 'svc-08'] },
  { id: 'tax-structure', name: 'Tax & Structure', sort_order: 3, service_ids: ['svc-11'] },
  { id: 'estate-succession', name: 'Estate & Succession', sort_order: 4, service_ids: ['svc-10'] },
  { id: 'philanthropy-impact', name: 'Philanthropy & Impact', sort_order: 5, service_ids: ['svc-09'] },
  { id: 'advisory', name: 'Advisory Relationships', sort_order: 6, service_ids: ['svc-02', 'svc-15'] },
];

const CC_PROMPTS = [
  { dimension_id: 'overall', prompt: 'Imagine you have five to ten years to live in perfect health — what, if anything, would you change about how the family\'s capital is used?', sort_order: 1 },
  { dimension_id: 'overall', prompt: 'When a big capital decision gets made, from what is it usually decided — fear, competition, care, system, values, or purpose?', sort_order: 2 },
  { dimension_id: 'investment', prompt: 'Do investment choices follow merit and process, or loyalty and relationships? Where does the portfolio contradict what the family says it values?', sort_order: 1 },
  { dimension_id: 'tax-structure', prompt: 'Is tax the dominant lens, or one input among several? Are structures ever re-examined for values alignment, not just efficiency?', sort_order: 1 },
  { dimension_id: 'estate-succession', prompt: 'Have the people been prepared as carefully as the documents? Who decides what when the current generation is no longer here — and do they know it?', sort_order: 1 },
  { dimension_id: 'philanthropy-impact', prompt: 'Is giving driven by conviction and a theory of change, or by requests, recognition, and the warm glow of giving?', sort_order: 1 },
  { dimension_id: 'advisory', prompt: 'Are advisors treated as vendors to negotiate against, or as thought partners on the whole picture — including meaning and purpose? Is anyone accountable for the whole?', sort_order: 1 },
];

// The paper's four dimensions of change — how movement between levels actually happens.
const CHANGE_DIMENSIONS = ['Physical', 'Intellectual', 'Emotional', 'Soulful'];

const ACC_ATTRIBUTION =
  'The Capital Consciousness lens adapts the Arc of Capital Consciousness (ACC) from ' +
  'Mo Lidsky, PhD — "From Survival to Freedom: Navigating the Arc of Capital Consciousness", ' +
  'published by Prime Quadrant. Seven levels describe a family\'s relationship with capital, ' +
  'from survival to freedom; as awareness deepens the circle of responsibility widens and ' +
  'emotional attachment to capital loosens, the two crossing at Level 4. The levels are not ' +
  'a hierarchy of worth. Used here with attribution as a reflective tool — the white paper ' +
  'itself is not reproduced in the app.';

// ---- the reference round: the current Appendix B assessment, seeded as a CLOSED,
// benchmark-free, NON-anchor round (§5.4, §5.7). The first cycle the family runs in-app
// becomes the anchor. ----
const REFERENCE_ROUND = {
  id: 'round-2026-baseline',
  label: '2026 Baseline (Appendix B)',
  // Appendix B carries no explicit effective date; it lives under the 2026 Planning &
  // Governance folder. TODO: confirm the real assessment date and adjust.
  effectiveDate: '2026-06-30',
  // Member scores transcribed from Appendix B columns H (Reg) / I (Ross) / J (Lucas) / K (SD).
  scores: {
    'svc-02': { reg: 3.5, ross: 3, lucas: 2.5, sd: 3 },
    'svc-03': { reg: 3, ross: 2, lucas: 1.5, sd: 3 },
    'svc-04': { reg: 5, ross: 5, lucas: 2, sd: 3.5 },
    'svc-05': { reg: 3.5, ross: 3, lucas: 1.5, sd: 3 },
    'svc-06': { reg: 3.5, ross: 1.5, lucas: 2, sd: 3 },
    'svc-07': { reg: 4, ross: 5, lucas: 4, sd: 4 },
    'svc-09': { reg: 3, ross: 3, lucas: 3, sd: 3.5 },
    'svc-10': { reg: 4.5, ross: 3, lucas: 2, sd: 3.5 },
    'svc-12': { reg: 3.5, ross: 3, lucas: 2, sd: 3.5 },
    'svc-13': { reg: 2.5, ross: 1, lucas: 2, sd: 2.5 },
  },
  // svc-01 Strategy, svc-08 Direct Investment, svc-11 Tax Planning, svc-14 Legal,
  // svc-15 External Relationships, svc-16 External Communication: Appendix B has only a
  // placeholder mean of 3 and no member cells — seeded as NOT assessed (no score rows,
  // not a fabricated 3).
  notAssessed: ['svc-01', 'svc-08', 'svc-11', 'svc-14', 'svc-15', 'svc-16'],
};

// Family context string reused by every Claude call (§7) so they stay consistent.
const FAMILY_CONTEXT =
  'Robinson Family Office — a Canadian single-family office in Ontario, ~CAD $30M AUM, ' +
  'multi-generational (three couples across two generations: Reg & Sheri-Dawn, Ross, Lucas). ' +
  'Prime Quadrant is the introducing investment advisor. The family office already runs an ' +
  'enterprise risk register and a shared family task list in the same application.';

module.exports = {
  GROUPS,
  LEVEL_LABELS,
  SERVICES,
  questionsForService,
  CC_LEVELS,
  CC_DIMENSIONS,
  CC_PROMPTS,
  CHANGE_DIMENSIONS,
  ACC_ATTRIBUTION,
  REFERENCE_ROUND,
  FAMILY_CONTEXT,
  SEED_ACTOR_ID: 'reg',
};
