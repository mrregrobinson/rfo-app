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
// Each service's `description` is factual, evidence-grounded context fed into every
// Claude call for that service (benchmark, wording suggestions) — see §7.1. Sourced from
// the family's own Planning & Governance documents — primarily the "Robinson Family
// Office 2026-01 Overview" (the current "Governance and Scope of Services" deck, with a
// formal Service Description + Summary of Approach per service) and its lettered
// Appendices A-K (each a dedicated policy document: Accountabilities & Succession,
// Maturity Scorecard, Risk Register, Conflict Resolution, Capability Growth Plan,
// Wellness Framework, Investment Policy Statement, Watch Collecting Policy, Philanthropy
// Policy Statement, Estate Framework, Living Estate Framework) — supplemented by earlier
// annual meeting decks/notes (2024-2026) for history and items that have since moved on
// (e.g. the mid-2026 addition of a Monetary Hedge asset class). Deliberately kept to
// observable facts and named artifacts, not a judgment of maturity level — that's for
// Claude (and the family) to derive. Before this, `description` was always empty on every
// service, which is a real reason earlier benchmarks read shallow — and an earlier draft
// of this content, written from a less complete set of documents, got some of these
// wrong in the conservative direction (e.g. describing the conflict-resolution framework
// as still a draft pending confirmation, when Appendix D is in fact a complete,
// already-in-use policy with worked example scenarios, reviewed annually at the Family
// Council's Q3 meeting). Shown in the app UI too (service drawer), directly editable by
// an admin.
const SERVICES = [
  {
    id: 'svc-01', groupId: 'strategic-services', number: 1, name: 'Strategy',
    description: 'A written vision, individual and shared family values, and named family priorities (both family-wide and individual) are documented and developed collaboratively through the Family Council. The family treats strategy as an ongoing alignment exercise and formally, recurrently asks itself: "Have we been living our values and are we prioritizing our priorities?" A disciplined annual review is built into the Family Council\'s Q4 agenda specifically: revisiting vision, values, and priorities as part of the Governance Model review, with an explicit stated focus on increasing the organization\'s maturity and effectiveness. A documented succession approach (triggers, timing determined by the outgoing person, transition-plan responsibility) exists (Appendix A).',
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
    description: "Two standing governance bodies exist with defined membership: a quarterly Family Council and a monthly Investment Committee. Governance is itself a standing, disciplined Q4 Family Council agenda item with concrete action steps, not just a status check: reviewing the Governance Model (vision, values, priorities), the Appendix A accountability chart, and every function/service being delivered, to determine changed approaches, accountabilities, or succession; reviewing accountabilities and the task list to assess progress and risk reduction; and an explicit stated focus on increasing the organization's maturity and effectiveness. A full RACI accountability chart (Appendix A) assigns Accountable/Responsible/Consulted/Informed for every function, naming third-party partners (PQ, EY, RBC, MLTA, Miller Thomson, Telus Health, Waterloo Region Community Foundation) alongside family members, and is reviewed annually as part of that Q4 cycle together with succession and spousal-inclusion criteria. A complete, already-in-use Conflict Resolution Framework (Appendix D) — four escalation steps plus worked example scenarios (investment strategy, expense allocation, philanthropy, succession) — exists. The family explicitly names this app's own formal maturity assessment model (Appendix B) as the mechanism for measuring annual governance improvement.",
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
    description: "A structured Enterprise Risk Register is maintained (in this same application's Risk module; Appendix C) — 14 categories across financial, family-relationship, health & safety, external, and operational/governance domains, each with a probability estimate, a named accountable owner, and mitigation actions tagged by whether they reduce probability or impact. Risk is deliberately viewed broadly, not just financial. It is a standing, disciplined Q2 Family Council agenda item with a required action-oriented outcome, not a passive review: the Council reviews the Enterprise Risk Register specifically \"to determine any new or changed actions that support the reduction or mitigation of the identified risks,\" and those mitigation items feed directly into the family's rolling two-year action plan.",
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
    description: "The Family Council itself functions as a structured, quarterly family meeting with a fixed agenda, and 'Unity' and 'Collaboration' are named, defined family priorities. Q3 of the Family Council's standing annual cycle is dedicated specifically to Family Wellness, Developing Capabilities, and Family Relationships together. The family explicitly prioritizes relationship over legacy and leans on its other services (strategy, governance, capability development, philanthropy, wellness, direct investing) as shared platforms for cohesion. When conflict does arise, a complete, already-in-use four-step Conflict Resolution Framework (discussion → Family Council review → mediation → arbitration; Appendix D) applies, with worked example scenarios documented — a finished policy, not a draft awaiting confirmation.",
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
    description: "This approach has been built over several years — starting with annual family meetings sharing business, financial, investment, and estate information, augmented by attendance at the family's investment advisor's events. It has since matured into a detailed, multi-year Capability Growth Plan (Appendix E) that sequences topics (governance, financial literacy, investing, philanthropy, wellness, leadership, cybersecurity) across specific retreats and in-year sessions, with its prioritization and sequencing informed by an internal survey of family perspectives and needs, not just imposed top-down. Q3 of the Family Council's standing annual cycle is dedicated specifically to Developing Capabilities, alongside Family Wellness and Family Relationships.",
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
    description: "Wellness is treated as a shared family priority, not purely an individual concern, guided by a documented Wellness Framework (Appendix F) that describes the family's approach to proactive planning, access to resources, and an environment that encourages care. It's supported by private benefit arrangements (e.g. executive medical, personal training) held by individual family units, and a dedicated wellness module within the structured Capability Growth Plan. Q3 of the Family Council's standing annual cycle is dedicated specifically to Family Wellness, alongside Developing Capabilities and Family Relationships.",
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
    description: "A written Investment Policy Statement (Appendix G) defines target allocations, disciplined asset allocation, and regular performance/risk monitoring, reviewed and amended by the Investment Committee (meets monthly); a Monetary Hedge asset class (watches, gold, PSA-graded cards, with its own governance — authentication, annual appraisal, insurance, arms-length protocols) was added in 2026, on top of cash, fixed income, public/private equity, private credit, diversifying strategies, and real assets. All family-unit portfolios are managed as one consolidated portfolio against the IPS, with an annual return-equalization process — reviewed and approved as a standing Q1 Family Council agenda item specifically (review/approval of the prior year's return and expense sharing, and confirmation of the model for the upcoming year), not left informal. Once the investment advisor recommends an investment, the Investment Committee additionally checks alignment with the family's stated values before proceeding — and the family periodically benchmarks its own positioning against external macro frameworks, producing an explicit aligned/gap scorecard and priority actions.",
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
    description: "Direct investing is approached selectively and deliberately, focused on opportunities where the family understands the risk, can apply appropriate governance, and can align involvement with family capacity. Current direct holdings (a real-estate joint venture, a family-member-led fund) are individually owned with advisory support from other family members; a formal due-diligence framework exists for evaluating new opportunities. A dedicated Watch Collecting Policy Statement (Appendix H) governs the family's Monetary Hedge collectibles (authentication, annual appraisal, insurance, arms-length protocols). The family's own stated future direction is a shared support-services model — pooling functions like accounting, IT, and possibly fractional executive services across direct holdings, rather than each being run fully independently.",
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
    description: "Philanthropy is governed by a complete, formal Philanthropy Policy Statement (Appendix I) covering purpose, mission, six guiding principles (alignment with values, impact and effectiveness, scale, collaboration, transparency and accountability, sustainability), funding priorities and prioritization, governance, budget, grant-making process, and measuring impact — reviewed and amended on a defined cycle, not an ad hoc document. A documented priorities matrix cross-references pillars of support (housing, social justice, food security, education, healthcare, arts) against communities of need (local, national, global). The family has a structured, multi-year partnership with the Waterloo Region Community Foundation, an established annual giving baseline, and a family member on that foundation's grant committee. Philanthropy has TWO distinct disciplined Family Council touchpoints per year, not one: Q1 reviews the Philanthropy Policy's annual plan and budget, and Q2 finalizes the detailed giving plan against that budget.",
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
    description: "Estate planning is treated as an ongoing process, not a one-time event, guided by a documented Estate Framework (Appendix J): each family member uses a dual primary/secondary-will structure (Ontario law), plus Powers of Attorney for both property and personal care, with an explicit equal-treatment philosophy for the next generation and a selective life-insurance strategy. This is complemented by a comprehensive Living Estate Framework (Appendix K) covering health/caregiving/capacity planning (including individual documented caregiver plans, Appendix K1), marital-breakdown considerations, and a staged approach to intergenerational wealth transfers during the parents' lifetime — already documented and integrated, not a future deliverable.",
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
    description: "The family's primary tax planner is EY, who manage and advise on normal annual reporting and compliance and draft special memos as needed, executed with support from MLT Aikins. Tax and estate planning are explicitly linked as an active initiative to consolidate business entities and further integrate planning across tax, estate, and investment decisions.",
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
    description: "EY provides centralized financial management for the family office and most related enterprises — bookkeeping, financial statements per legal entity, and personal/corporate tax returns — while family members individually handle remittances like GST and payroll tax for their own enterprises. Professional fees and expense-sharing categories are defined and reviewed as a standing Q1 Family Council agenda item specifically — a 'financial review of the previous year' — alongside the return/expense-sharing review. Integrating the family's internal financial/accounting systems with its investment advisor's systems, including using AI for elements of that workflow, is a named, active initiative.",
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
    description: "Current practice focuses primarily on ensuring secure communication with third-party partners and using a password-manager cloud solution (1Password) for shared family-office documents and password management. The Enterprise Risk Register separately names specific, tracked cyber mitigations (security training, banking controls, secure third-party data transfer, an internal security policy, external audits, an incident response plan), each with a named accountable owner. Maturing cybersecurity training, policy, and infrastructure to 'industry standard' is a named, active goal, and a cybersecurity module is scheduled in the family's structured Capability Growth Plan.",
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
    description: "Legal advice is coordinated centrally across entities and activities: MLT Aikins handles matters relating to Saskatchewan-registered corporations, and Miller Thomson handles estate and cohabitation agreements, which are personal and based on Ontario law. The underlying document set (wills, powers of attorney, inter-spousal/cohabitation agreements) is maintained under the Estate Framework (Appendix J) rather than as a standalone legal policy.",
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
    description: "The family manages external relationships centrally to ensure consistency, accountability, and alignment with family priorities — advisors and partners (the investment advisor, EY for tax/finance, MLT Aikins and Miller Thomson for legal, RBC for banking) are engaged as extensions of the family office, not independent silos. A formal due-diligence framework exists specifically for evaluating advisor and investment recommendations.",
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
    description: "External communication is intentional and controlled, focused on clarity, discretion, and reputational stewardship — the family deliberately keeps decision-making confidential within the family circle. There is explicit integration with Philanthropy: the family takes a modest, non-congratulatory approach to how its giving is communicated externally.",
    levels: [
      'No intentional external communication. Reactive responses only.',
      'Limited, informal communication coordinated by individuals.',
      'Clear messaging and protocols for external communication.',
      'Proactive, consistent communication aligned with family values and objectives.',
      'Highly intentional external presence supporting reputation, privacy, and influence.',
    ],
  },
];

// ---- starter question set (4 per service, admin-editable; §5.3) ----
// Maturity only — Capital Consciousness is a separate, once-per-round instrument (see
// CONSCIOUSNESS_STATEMENTS below), not a per-service question. Asking the same one or two
// consciousness-flavoured questions on all 16 services turned out to be a shallow,
// repetitive read, not a real measurement — this reverts to a plain maturity-only
// worksheet per service.
//
// The "Leading Practice" question below is explicitly about the family's OWN habit of
// comparing and improving — not about having commissioned outside benchmarking. This
// module's Claude benchmark (run per service, see §7.1) is what supplies the external
// comparison; scoring yourself a 5 here does not require you to have done that yourselves.
function questionsForService(svc) {
  return [
    {
      prompt: `Which of the five descriptions best matches where the family office is today on ${svc.name}?`,
      help_text: 'Pick the single description that fits best overall, even if some details differ. "Leading Practice" describes a habit of comparing and improving — it does not require you to have hired outside benchmarking yourselves; this assessment\'s own Claude benchmark supplies that external comparison.',
      response_kind: 'level_pick', weight: 2,
    },
    {
      prompt: `There is a documented, agreed approach to ${svc.name} that is actually followed in practice.`,
      help_text: '', response_kind: 'scale_1_5', weight: 1,
    },
    {
      prompt: `Our handling of ${svc.name} is embedded in day-to-day systems and routines — disciplined, monitored, and coordinated with the areas it touches.`,
      help_text: '', response_kind: 'scale_1_5', weight: 1,
    },
    {
      prompt: `We deliberately compare how we approach ${svc.name} against how well-run peer family offices do it, and adjust as a result.`,
      help_text: 'This is about the habit of comparing and improving, not about having run your own external benchmarking study — that\'s what this tool\'s Claude benchmark is for.',
      response_kind: 'scale_1_5', weight: 1,
    },
  ];
}

// ---- Capital Consciousness — a standalone, once-per-round instrument (§5.8) ----
// Disconnected again from the per-service maturity worksheet (see migration 037's header
// comment for why). One statement per level. The level is derived by picking the ONE
// statement that best reflects the family today (migration 040) — not a bare
// self-placement on the named arc (nobody has to know the framework's level names to
// answer, only recognize which plain-language statement fits). Two earlier mechanics
// tried here — an independent 1-5 "how true" rating per statement, then a full ranking of
// all seven from most to least true — both proved more confusing than the thing they were
// meant to simplify.
const CONSCIOUSNESS_STATEMENTS = [
  { level: 1, statement: 'When it comes to our wealth, our first instinct is to protect what we have and avoid losing it — even when that means passing on opportunities that are probably fine.' },
  { level: 2, statement: 'We pay close attention to returns, fees, and how we compare to others, judging most financial decisions mainly on their own merits rather than as part of the bigger picture.' },
  { level: 3, statement: "We think about our wealth mainly in terms of protecting and providing for the people we love, even if we haven't always had the harder conversations about how it should be used." },
  { level: 4, statement: 'We see our finances as one connected system — investments, tax, estate, and giving are coordinated together rather than handled in separate silos.' },
  { level: 5, statement: "We regularly ask whether our financial choices actually reflect what we value, and we're willing to sit with the answer even when it's uncomfortable." },
  { level: 6, statement: 'We think of our capital as a tool for creating positive impact beyond our own family, guided by a real sense of what we are trying to change in the world.' },
  { level: 7, statement: "Managing our wealth carefully matters to us, but it doesn't define who we are or dominate how we think about our lives." },
];

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

// Intro copy + the optional free-text reflection shown once, beneath the 7 statements.
const CONSCIOUSNESS_QUESTION = {
  intro: 'Read all seven statements and pick the ONE that best reflects how your family actually relates to its capital today — not how you wish it were.',
  reflectionPrompt: 'Anything you\'d add? (optional)',
};

// The four dimensions of change — how movement between levels actually happens.
const CHANGE_DIMENSIONS = ['Physical', 'Intellectual', 'Emotional', 'Soulful'];

// A short standing note shown alongside the consciousness result. The seven-level model is
// treated as the family's own reflective tool, assessed once per round for the family as
// a whole (not per service).
const CONSCIOUSNESS_NOTE =
  'Seven levels describe how the family relates to its capital, from survival to freedom. ' +
  'As awareness deepens the circle of responsibility widens (self → family → community → ' +
  'society) while emotional attachment to capital loosens; the two shifts cross around ' +
  'Level 4. The levels are not a hierarchy of worth — the aim is simply to notice which ' +
  'level the family is deciding from right now, and what the next one would make possible.';

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
// Cross-cutting context passed into every Claude call in this module (benchmark, wording
// suggestions, round synthesis) alongside whichever service-specific `description` above
// applies. Kept to verifiable facts about how the family actually operates — sourced from
// its own Planning & Governance documents (2024-2026) — not a judgment of maturity level.
// Before this, the whole module ran on a single generic sentence, which is a real reason
// benchmarks read shallow regardless of which service was being assessed.
const FAMILY_CONTEXT =
  'Robinson Family Office — a Canadian single-family office in Ontario, ~CAD $30M AUM, ' +
  'multi-generational (three couples across two generations: Reg & Sheri-Dawn, Ross, Lucas). ' +
  "Deliberately smaller and leaner than a 'typical' family office (which the family itself " +
  'benchmarks as 8-15 staff, 4-6 core functions, serving 25-50 family members across 3-4 ' +
  'generations) — run as a virtual structure rather than a separate corporation. Its own ' +
  'stated philosophy: "strong relationships, disciplined governance, and thoughtful ' +
  'stewardship," balancing professionalism (treating the family office as a business) with ' +
  'humility, and prioritizing trust, wellness, learning, and family relationships over purely ' +
  'financial outcomes. The family office\'s full operating model is documented as a formal ' +
  '"Governance and Scope of Services" set: a main overview naming, for every one of its 16 ' +
  'services, a Service Description, a Summary of the family\'s actual approach, and a ' +
  'supporting lettered appendix (A: Accountabilities & Succession, B: Maturity Scorecard, C: ' +
  'Risk Register, D: Conflict Resolution Framework, E: Capability Growth Plan, F: Wellness ' +
  'Framework, G: Investment Policy Statement, H: Watch Collecting Policy, I: Philanthropy ' +
  'Policy Statement, J: Estate Framework, K: Living Estate Framework). Governance runs through ' +
  'two standing bodies. The Family Council (Reg, Sheri-Dawn, Ross, Lucas) sets long-term ' +
  'strategic goals, ensures alignment with family values, oversees major financial and ' +
  'governance decisions, and monitors progress on governance accountabilities and succession — ' +
  'meeting quarterly with a fixed, disciplined agenda that pairs each review with concrete ' +
  'action steps, not just a status update: Q1 — financial review of the previous year; review ' +
  'and approval of the prior year\'s return and expense sharing; review of the Philanthropy ' +
  'Policy\'s annual plan and budget; confirmation of the return/expense-sharing model for the ' +
  'upcoming year. Q2 — review of the Enterprise Risk Register to determine new or changed ' +
  'mitigation actions; finalizing the detailed giving plan against budget. Q3 — focus on ' +
  'Family Wellness, Developing Capabilities, and Family Relationships. Q4 — review of the ' +
  'Governance Model (vision, values, priorities, the Appendix A accountability chart, and ' +
  'every function/service being delivered) to determine changed approaches, accountabilities, ' +
  'or succession; review of accountabilities and the task list to assess progress and risk ' +
  'reduction; an explicit focus on increasing the organization\'s maturity and effectiveness. ' +
  'A monthly Investment Committee (Reg, Sheri-Dawn, Ross; Lucas optional) runs alongside this. ' +
  'A full RACI accountability ' +
  'chart (Appendix A) assigns Accountable/Responsible/Consulted/Informed, naming third-party ' +
  'partners, for every function, reviewed annually alongside succession and spousal-inclusion ' +
  'criteria. The family already runs an informal internal capability self-assessment as a ' +
  'standing practice distinct from this application, and its 2026 plan formally adopts this ' +
  "app's own annual Claude-benchmarked process (Appendix B) as the ongoing successor to that " +
  'exercise. Named professional advisors/partners: the introducing investment advisor (due ' +
  'diligence, analysis, reporting, compliance for passive/private-markets investing), EY (tax ' +
  'and financial administration), MLT Aikins and Miller Thomson (legal, estate), RBC ' +
  '(banking), the Waterloo Region Community Foundation (philanthropy). The family office ' +
  "already runs an Enterprise Risk Register (in this same application's Risk module) and a " +
  'shared Family Task List.';

module.exports = {
  GROUPS,
  LEVEL_LABELS,
  SERVICES,
  questionsForService,
  CC_LEVELS,
  CONSCIOUSNESS_STATEMENTS,
  CONSCIOUSNESS_QUESTION,
  CHANGE_DIMENSIONS,
  CONSCIOUSNESS_NOTE,
  REFERENCE_ROUND,
  FAMILY_CONTEXT,
  SEED_ACTOR_ID: 'reg',
};
