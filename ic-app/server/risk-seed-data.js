// Reconciled initial seed content for the Risk Management module.
//
// Transcribed from the two source documents in the repo root:
//   - RFO_Risk_Register_v5.xlsx        (Risk Register + IPS + Legend sheets)
//   - RFO_Risk_Register_Notes_v5.docx  (Appendix C — per-risk rationale, mitigations,
//                                       open action items, framework/context notes)
//
// Each category's `note` is general standing commentary on the risk. In the source
// register this was the "Dalio Framework Note"; it is kept verbatim but the field is no
// longer framework-bound
// and can hold any longer-lived context or watch-item for the risk.
//
// Where the spreadsheet and the notes disagree, the NOTES win (they are the longer-form,
// later-reviewed version). Known reconciliations, flagged inline with SOURCE DISCREPANCY:
//   - The spreadsheet numbers Monetary Hedge as row 2 and has two rows numbered "9".
//     The notes' structure is authoritative: 6 domains A–F, 14 risks, Monetary Hedge &
//     Direct Investment = Risk 14 in Domain F; Cognitive decline = 8, Death = 9.
//   - Risk 11 status reads "IN PROGRESS — Q3 2026" in both sources; normalised here to
//     the "In Progress" status enum value (§5.2 of the build spec).
//
// Action priority buckets (Immediate / Active / Monitor) come from the notes'
// "Summary of Open Action Items by Priority" section. An action that appears in a
// category's own list but not in that summary is seeded as 'Active' (build spec §5.7).

const DOMAINS = [
  { id: 'A', name: 'Financial Risks', sort_order: 1 },
  { id: 'B', name: 'Family Relationship Risks', sort_order: 2 },
  { id: 'C', name: 'Family Health & Safety Risks', sort_order: 3 },
  { id: 'D', name: 'External Event Risks', sort_order: 4 },
  { id: 'E', name: 'Operational & Governance Risks', sort_order: 5 },
  { id: 'F', name: 'Investment Execution Risks', sort_order: 6 },
];

const SCALE = [
  { kind: 'probability', score: 1, label: 'Rare', detail: 'Less than 5% probability in any given year' },
  { kind: 'probability', score: 2, label: 'Unlikely', detail: '5–20% probability in any given year' },
  { kind: 'probability', score: 3, label: 'Possible', detail: '20–50% probability in any given year' },
  { kind: 'probability', score: 4, label: 'Likely', detail: 'Greater than 50% probability in any given year' },
  { kind: 'impact', score: 1, label: 'Minor', detail: 'Temporary inconvenience; recoverable with minimal effort' },
  { kind: 'impact', score: 2, label: 'Moderate', detail: 'Meaningful disruption; recoverable but requires significant effort' },
  { kind: 'impact', score: 3, label: 'Significant', detail: 'Serious harm to financial position, relationships or governance' },
  { kind: 'impact', score: 4, label: 'Severe', detail: 'Existential threat to family wealth, health, cohesion or legacy' },
];

// Static reference shown on the page as "IPS context" (build spec §5.7) — background for
// Risks 1, 2, 10, 14, not register data.
const IPS_CONTEXT = {
  note: 'IPS — 8 asset classes. Monetary Hedge (watches · gold · PSA-graded cards) added as the 8th class, target 3% / max 5%, funded from the cash overweight. No single Monetary Hedge sub-category to exceed 3% of the total portfolio without IC approval.',
  classes: [
    { name: 'Cash & Equivalents', target: '0%', min: '0%', max: '54%' },
    { name: 'Fixed Income', target: '3%', min: '0%', max: '13%' },
    { name: 'Equity', target: '23%', min: '13%', max: '33%' },
    { name: 'Credit', target: '25%', min: '15%', max: '35%' },
    { name: 'Diversifying Strategies', target: '8%', min: '0%', max: '18%' },
    { name: 'Real Assets', target: '15%', min: '5%', max: '25%' },
    { name: 'Private Equity', target: '20%', min: '10%', max: '30%' },
    { name: 'Monetary Hedge', target: '3%', min: '0%', max: '5%' },
  ],
};

// due: quarter string parsed straight from the action wording where the source states one.
const CATEGORIES = [
  {
    id: 'risk-01', number: 1, domainId: 'A',
    title: 'Investment & Capital Risk',
    description: 'Major reduction in investable capital from market dislocation, manager failure, concentration, or fraud',
    accountable: 'Reg Robinson / Prime Quadrant',
    note: 'Dalio identifies late-cycle debt dynamics as the defining macro risk today. The fixed income overweight is the single area most exposed to his warning. The Monetary Hedge allocation directly addresses his 5–15% alternative money prescription — partially through watches today, building toward gold and graded cards over time.',
    inherent: [3, 4], residual: [2, 3],
    status: 'Active — Well Managed', nextReview: 'Q2 2027',
    mitigations: [
      '8-asset-class IPS with defined min/max ranges reviewed annually',
      'PQ monthly IC meetings; quarterly investment reports; proactive manager monitoring',
      '2-year cash buffer maintained to prevent forced selling',
      'Unfunded commitment schedule tracked quarterly',
      'FX hedging managed by PQ; natural 50/50 CAD/USD balance as structural hedge',
      'No single manager represents more than approximately 15% of the total portfolio',
    ],
    actions: [
      { title: 'Reduce fixed income overweight (17.1% vs 13% IPS maximum) — agree redeployment plan with PQ', priority: 'Active', ownerText: 'PQ / Reg', due: 'Q3 2026' },
      { title: 'Arctos Fund III investment decision — early-close deadline', priority: 'Active', ownerText: 'Ross / PQ', due: 'Q2 2026' },
      { title: 'Define USD concentration ceiling at 60% without explicit IC approval and add to IPS', priority: 'Active', ownerText: 'PQ / Reg', due: '' },
    ],
  },
  {
    id: 'risk-02', number: 2, domainId: 'A',
    title: 'Foreign Exchange Risk',
    description: 'Significant CAD appreciation eroding USD-denominated portfolio value (~50%) and raising CAD cost of USD capital calls (~C$4.8M unfunded)',
    accountable: 'PQ / Reg Robinson',
    note: "Dalio explicitly warns of USD debasement. The watch collection's CHF denomination is a meaningful, if modest, response to this risk within the Monetary Hedge allocation.",
    inherent: [2, 2], residual: [2, 2],
    status: 'Active — Partially Mitigated', nextReview: 'Q2 2027',
    mitigations: [
      'Natural 50/50 CAD/USD portfolio composition reduces net FX exposure',
      'PQ manages FX within individual investment mandates',
      'CAD living expenses provide further natural hedge against USD depreciation',
      'Watch collection provides partial CHF exposure as a by-product of the Monetary Hedge allocation',
    ],
    actions: [
      { title: 'Add quarterly FX exposure summary by asset class to IC reporting', priority: 'Monitor', ownerText: 'PQ', due: 'Q3 2026' },
      { title: 'Define a 60% USD ceiling without explicit IC approval and add to IPS', priority: 'Active', ownerText: 'PQ / Reg', due: '' },
      { title: 'Add FX balance as a standing annual IPS review item', priority: 'Active', ownerText: 'PQ / Reg', due: '' },
    ],
  },
  {
    id: 'risk-03', number: 3, domainId: 'A',
    title: 'Legal & Regulatory Risk',
    description: 'Adverse change to Canadian tax legislation or foreign property reporting failure causing unexpected liability',
    accountable: 'Reg Robinson / EY',
    note: 'Dalio identifies political polarization as making fiscal discipline unavailable — which predictably leads to higher taxes on wealth. The legislative watch process is a direct mitigation.',
    inherent: [3, 3], residual: [2, 2],
    status: 'Active — Partially Mitigated', nextReview: 'Q4 2026',
    mitigations: [
      'EY engaged for all tax matters: annual returns, T1135 foreign property reporting, proactive planning',
      'MLTA engaged for legal matters',
      'T1135 confirmed annually with EY before filing deadline',
    ],
    actions: [
      { title: 'Request annual legislative watch memo from EY — first delivery', priority: 'Active', ownerText: 'Reg / EY', due: 'Q4 2026' },
      { title: 'Add Q4 Family Council agenda item for annual legislative review', priority: 'Active', ownerText: 'Reg', due: '' },
      { title: 'Confirm with EY the tax treatment of Monetary Hedge assets (watches, gold, cards) on disposition and the reporting obligations when transitioning from personal to investment classification', priority: 'Active', ownerText: 'Reg / EY', due: '' },
      { title: 'Confirm T1135 captures all Cayman/Delaware fund interests', priority: 'Active', ownerText: 'Reg / EY', due: 'Q4 2026' },
    ],
  },
  {
    id: 'risk-04', number: 4, domainId: 'B',
    title: 'Family Relationships Risk',
    description: 'Breakdown or sustained strain in family relationships — across the family, within any of the three couples, or between family units',
    accountable: 'Reg Robinson / Sheri-Dawn Robinson',
    note: "Not directly addressed in Dalio's framework. The family office's own philosophy is the relevant reference: relationships take priority over financial outcomes.",
    inherent: [2, 4], residual: [1, 3],
    status: 'Active — Well Managed', nextReview: 'Q3 2026',
    mitigations: [
      'Family Council with quarterly structured agendas and annual retreat',
      'Shared Values Statement (Integrity, Compassion, Sharing, Learning, Passion)',
      'Conflict Resolution Framework (Appendix D): four-stage process',
      'Wellness Framework treating relationship health as a shared family priority',
      'Living Estate Framework (Appendix K): Marital Breakdown section — reviewed periodically with MLTA',
      'Estate structures and beneficiary designations reviewed with MLTA',
      'Open communication culture; philanthropy and direct investing as shared platforms',
    ],
    actions: [
      { title: 'Confirm that all six family members incl. Beisan and Kim can access wellness and relationship support', priority: 'Monitor', ownerText: 'Sheri-Dawn', due: 'Q3 2026' },
      { title: "Ensure Living Estate Marital Breakdown section reflects current asset structure including Monetary Hedge holdings and Ross's watch business", priority: 'Active', ownerText: 'Sheri-Dawn', due: '' },
      { title: "Confirm Ross's watch business ownership structure is clearly documented and legally registered", priority: 'Active', ownerText: 'Reg / Ross', due: '' },
    ],
  },
  {
    id: 'risk-05', number: 5, domainId: 'B',
    title: 'Next Generation Readiness Risk',
    description: 'Capacity and capability to responsibly steward wealth or lead the family office',
    accountable: 'Reg Robinson / Ross Robinson',
    note: "Consistent with Dalio's counsel that individuals should plan for their own limitations and prepare successors proactively.",
    inherent: [2, 4], residual: [2, 3],
    status: 'Active — Partially Mitigated', nextReview: 'Q3 2026',
    mitigations: [
      'Capability Growth Plan with structured learning agenda',
      'Ross: IC membership and Direct Investment Accountable role — now extended to Monetary Hedge Accountable',
      '2026 retreat: investment philosophy, IPS, due diligence, and Meaning of Money session',
      'Progressive role expansion model; philanthropy as shared learning platform',
    ],
    actions: [
      { title: "Deepen Lucas's involvement: expand from Informed to Consulted in 1–2 service areas", priority: 'Monitor', ownerText: 'Reg', due: 'Q4 2026' },
      { title: 'Annual readiness reflection at Q3 Family Council', priority: 'Active', ownerText: 'Reg', due: '' },
      { title: "Ensure Ross's understanding of the Monetary Hedge governance framework — particularly the arms-length protocol and sub-category concentration limits", priority: 'Active', ownerText: 'Reg / Ross', due: '' },
      { title: "Monitor Ross's combined load across watch business, IC role, Monetary Hedge Accountable, and family office responsibilities", priority: 'Active', ownerText: 'Reg', due: '' },
    ],
  },
  {
    id: 'risk-06', number: 6, domainId: 'C',
    title: 'Personal Health Risk',
    description: 'Acute or chronic health event — physical or mental — affecting any of the six family members',
    accountable: 'All family members / Reg & Sheri-Dawn',
    note: "Not directly addressed in Dalio's framework. The family office's own Wellness priority is the relevant reference.",
    inherent: [3, 3], residual: [2, 2],
    status: 'Active — Well Managed', nextReview: 'Q3 2026',
    mitigations: [
      'Telus Health annual assessments for Reg and Sheri-Dawn',
      'Wellness Framework treats health as a shared family priority',
      '2025 and 2026 retreat wellness sessions cover mental and emotional health equally',
      'Caregiver Plan (Appendix K1) for Reg',
      '2-year cash buffer eliminates financial pressure during health disruption',
      'Long-term disability insurance identified as planning item — status to be confirmed',
    ],
    actions: [
      { title: 'Confirm all six family members including Beisan and Kim can access wellness and mental health support', priority: 'Monitor', ownerText: 'Reg & Sheri-Dawn', due: 'Q3 2026' },
      { title: 'Confirm whether long-term disability insurance has been implemented for Reg', priority: 'Active', ownerText: 'Reg / EY', due: 'Q3 2026' },
      { title: 'Ensure Caregiver Plan is current and has been shared with relevant family members', priority: 'Active', ownerText: 'Reg & Sheri-Dawn', due: '' },
    ],
  },
  {
    id: 'risk-07', number: 7, domainId: 'C',
    title: 'Personal Safety Risk',
    description: 'Safety incident — personal security, travel, home, or emergency — causing harm, trauma, or financial loss to any family member',
    accountable: 'Ross Robinson / All family members',
    note: "Dalio's geopolitical cycle framework — capital wars, social polarization, rising wealth inequality — increases targeted approaches toward high-net-worth families.",
    inherent: [2, 3], residual: [2, 2],
    status: 'Active — Partially Mitigated', nextReview: 'Q3 2026',
    mitigations: [
      '2026 Capability Growth Plan: dedicated safety session covering personal, travel, home, and emergency planning',
      'Cyber security protocols (MFA, wire transfer confirmation) reduce financial attack surface',
      'Monetary Hedge storage protocol: watches held in rated secure location; scheduled insurance; not disclosed publicly',
    ],
    actions: [
      { title: 'Complete the 2026 safety planning session for all family members', priority: 'Active', ownerText: 'Ross / All', due: 'Q3 2026' },
      { title: 'Establish family emergency contact protocol', priority: 'Active', ownerText: 'Ross / All', due: '' },
      { title: 'Confirm international travel health and emergency medical insurance', priority: 'Active', ownerText: 'Ross / All', due: '' },
      { title: "Confirm that the storage location for Reg's watch collection and Monetary Hedge assets meets the insurer's security requirements", priority: 'Active', ownerText: 'Ross / Reg', due: '' },
    ],
  },
  {
    id: 'risk-08', number: 8, domainId: 'C',
    title: 'Cognitive & Capacity Decline Risk',
    description: "Gradual reduction in Reg's cognitive or decision-making capacity without a clear trigger for transition",
    accountable: 'Reg Robinson / MLTA / Ross Robinson',
    note: "Consistent with Dalio's counsel that individuals should plan for their own limitations and prepare successors proactively.",
    inherent: [2, 4], residual: [1, 3],
    status: 'Active — Partially Mitigated', nextReview: 'Q3 2026',
    mitigations: [
      'POA for Property and Personal Care executed',
      "Ross is named successor for the majority of Reg's Accountable roles — including oversight of the Monetary Hedge portfolio",
      "Ross's IC and Direct Investment role (now extended to Monetary Hedge) builds readiness",
      'Annual wellness review at Q3 Family Council creates a recurring context',
    ],
    actions: [
      { title: 'Begin progressive role transfer Reg → Ross across 2–3 service lines in the next 12 months', priority: 'Immediate', ownerText: 'Reg / Ross', due: 'Q4 2026' },
      { title: 'Document POA activation protocol as a Living Estate addendum with MLTA', priority: 'Immediate', ownerText: 'Reg / MLTA', due: 'Q3 2026' },
      { title: 'Add cognitive capacity as a standing theme at the Q3 Family Council wellness agenda', priority: 'Active', ownerText: 'Reg', due: '' },
    ],
  },
  {
    id: 'risk-09', number: 9, domainId: 'C',
    title: 'Death / Early Death Risk',
    description: 'Death of any family member — Reg, Sheri-Dawn, Ross, Beisan, Lucas, or Kim — causing estate complexity, governance gaps, equalization implications, and profound family disruption',
    accountable: 'Reg Robinson / MLTA',
    note: 'Dalio emphasises estate planning as a financial risk management matter. The incompleteness of life insurance and trustee arrangements represents a genuine gap.',
    inherent: [2, 4], residual: [1, 3],
    status: 'INCOMPLETE — Action Required', nextReview: 'Q3 2026',
    mitigations: [
      'Primary and Secondary Wills for Reg and Sheri-Dawn (Ontario dual-will); POA instruments executed',
      'Succession roles documented in Appendix A',
      'Equal treatment of next generation as estate default',
      'Living Estate Framework provides values-aligned wealth transfer principles',
    ],
    actions: [
      { title: 'Life insurance structure for Reg and Sheri-Dawn: EY/MLTA to advise', priority: 'Immediate', status: 'incomplete', ownerText: 'EY / MLTA', due: 'Q3 2026' },
      { title: 'Trustee appointment: MLTA to recommend', priority: 'Immediate', status: 'incomplete', ownerText: 'MLTA', due: 'Q3 2026' },
      { title: 'Confirm Ross and Beisan have current wills and POAs addressing watch business, IC role, and Monetary Hedge Accountable responsibilities', priority: 'Active', ownerText: 'Reg / MLTA', due: 'Q4 2026' },
      { title: 'Confirm Lucas and Kim have current wills and POAs', priority: 'Active', ownerText: 'Reg / MLTA', due: 'Q4 2026' },
      { title: 'Document a 30-day governance and financial access protocol for any death scenario', priority: 'Active', ownerText: 'Reg / MLTA', due: '' },
      { title: 'Confirm Monetary Hedge assets (watches, gold, cards) are addressed in estate documents with clear ownership, storage access, and valuation basis', priority: 'Active', ownerText: 'Reg / MLTA', due: '' },
    ],
  },
  {
    id: 'risk-10', number: 10, domainId: 'D',
    title: 'External Events Risk',
    description: 'Major external disruption — economic recession, pandemic, geopolitical shock, natural disaster — impairing family financial security, physical safety, or access to essential services',
    accountable: 'Reg Robinson / Prime Quadrant',
    note: "Dalio's Five Forces framework identifies the current moment as a convergence of late debt cycle, peak geopolitical competition, AI disruption, domestic polarization, and climate events. The Monetary Hedge allocation is the family's most direct structural response to the most acute of these risks.",
    inherent: [2, 3], residual: [2, 2],
    status: 'Active — Well Managed', nextReview: 'Q2 2027',
    mitigations: [
      '2-year cash buffer: eliminates forced selling during market dislocations',
      'Diversified 8-asset-class IPS reduces single-event concentration risk',
      "Monetary Hedge allocation (watches, gold, cards): tangible hard assets providing direct monetary debasement hedge — Dalio's most specific portfolio prescription",
      'Diversifying Strategies allocation: manager-skill-based low-correlation return in normal markets — complements rather than duplicates Monetary Hedge',
      'Real Assets: inflation-linked tangible assets providing additional hard asset exposure',
      '~50/50 CAD/USD geographic diversification',
      '2026 safety learning agenda covers emergency and crisis preparedness',
    ],
    actions: [
      { title: 'Complete the 2026 safety session covering emergency and crisis management', priority: 'Active', ownerText: 'Sheri-Dawn', due: 'Q3 2026' },
      { title: 'Confirm emergency planning covers a multi-week sustained disruption scenario', priority: 'Active', ownerText: 'Sheri-Dawn', due: '' },
      { title: "Ask PQ at the next IC meeting to quantify the Monetary Hedge portfolio's contribution to the Dalio alternative money prescription (combined exposure across watches, gold, and cards as a % of portfolio)", priority: 'Active', ownerText: 'Reg / PQ', due: '' },
    ],
  },
  {
    id: 'risk-11', number: 11, domainId: 'E',
    title: 'Cyber Security Risk',
    description: 'Phishing, wire fraud, ransomware, or data breach targeting family office accounts or family members',
    accountable: 'Ross Robinson',
    note: 'State-sponsored cyber activity targeting high-net-worth individuals is an active and escalating threat.',
    inherent: [3, 3], residual: [2, 3],
    // SOURCE DISCREPANCY: both sources say "IN PROGRESS — Q3 2026"; normalised to the enum value.
    status: 'In Progress', nextReview: 'Q4 2026',
    mitigations: [
      'MFA required on all financial platforms',
      'Wire transfer verbal confirmation for all transfers above C$10,000',
      'Digital awareness training planned (Ross, Q3 2026)',
    ],
    actions: [
      { title: 'Complete cybersecurity awareness training for all four family members', priority: 'Active', ownerText: 'Ross', due: 'Q3 2026' },
      { title: 'Commission an external cybersecurity review', priority: 'Active', ownerText: 'Ross', due: 'Q4 2026' },
      { title: 'Document a one-page cybersecurity policy', priority: 'Active', ownerText: 'Ross', due: '' },
      { title: 'Extend the wire transfer confirmation protocol explicitly to cover Monetary Hedge transactions (auction house deposits, dealer payments, PSA submission fees above C$10K)', priority: 'Active', ownerText: 'Ross', due: '' },
    ],
  },
  {
    id: 'risk-12', number: 12, domainId: 'E',
    title: 'Key Advisor Dependency Risk',
    description: 'Disruption to a primary external advisor (Prime Quadrant, EY, MLTA, RBC) through acquisition, key personnel departure, or service model change',
    accountable: 'Reg Robinson / Ross Robinson',
    note: "Dalio's emphasis on diversification applies to advisors as well as investments.",
    inherent: [2, 3], residual: [2, 2],
    status: 'Active — Partially Mitigated', nextReview: 'Q2 2027',
    mitigations: [
      'Both Reg and Ross maintain direct relationships with PQ and EY at senior partner level',
      'Family records maintained independently of PQ platform',
      "Ross's investment education builds intellectual independence",
      "For Monetary Hedge: Ross maintains direct relationships with auction houses (Christie's, Phillips, Goldin, PWCC) and PSA — the Monetary Hedge equivalent of PQ",
    ],
    actions: [
      { title: 'Prepare an alternative advisor brief for PQ and EY: top 2 alternatives, transition requirements', priority: 'Active', ownerText: 'Reg', due: 'Q1 2027' },
      { title: 'Identify and document the primary Monetary Hedge specialist relationships: watch authentication specialist, gold custodian/ETF provider, PSA grading account, preferred auction house contacts', priority: 'Monitor', ownerText: 'Ross', due: 'Q4 2026' },
    ],
  },
  {
    id: 'risk-13', number: 13, domainId: 'E',
    title: 'Reputational & Privacy Risk',
    description: 'Unwanted public disclosure of family wealth, social media conduct, or a philanthropy/investment association creating reputational damage',
    accountable: 'Sheri-Dawn Robinson / Reg Robinson',
    note: "Dalio's observation that institutional trust erodes during political polarization cycles suggests high-net-worth families face greater scrutiny.",
    inherent: [2, 3], residual: [1, 3],
    status: 'Active — Partially Mitigated', nextReview: 'Q2 2027',
    mitigations: [
      'Sheri-Dawn designated External Communication Accountable',
      'Ontario corporate structure provides ownership privacy',
      'WRCF relationship reduces direct grant controversy',
    ],
    actions: [
      { title: 'Document a family external communication protocol including specific guidance on sharing Monetary Hedge acquisitions on social media', priority: 'Monitor', ownerText: 'Sheri-Dawn / Reg', due: 'Q3 2026' },
      { title: 'Confirm corporate privacy under Ontario beneficial ownership requirements with MLTA', priority: 'Active', ownerText: 'Sheri-Dawn / Reg', due: '' },
    ],
  },
  {
    id: 'risk-14', number: 14, domainId: 'F',
    title: 'Monetary Hedge & Direct Investment Risk',
    description: 'Fraud, authentication failure, overpayment, inadequate insurance, conflict of interest, or poor exit planning across the Monetary Hedge portfolio (watches, gold, PSA-graded cards) and direct investments',
    accountable: 'Ross Robinson (Monetary Hedge lead) / Reg Robinson (Watch Collection owner)',
    note: "The Monetary Hedge allocation is the most direct expression of Dalio's alternative money prescription in the portfolio. His counsel to hold 5–15% in gold or alternative money is being addressed through a diversified approach — watches as the primary holding, gold as the most liquid and standardised expression, and PSA-graded cards as a North American collector-demand asset. At 3% target growing toward 5% maximum, the category partially closes the gap Dalio's scorecard has identified while maintaining the governance discipline appropriate to tangible asset investing.",
    inherent: [2, 2], residual: [2, 2],
    status: 'Active — Partially Mitigated', nextReview: 'Q2 2027',
    mitigations: [
      'Watches: independent-specialist authentication for all acquisitions above C$10K; 3 auction comparables required; annual independent appraisal; storage in a rated secure location with scheduled personal articles insurance; arms-length protocol for any transaction involving Ross\'s watch business',
      'Gold: physical gold via allocated storage (Royal Canadian Mint or Sprott) or gold ETF (iShares Gold Bullion ETF — CGL.C); no authentication risk; priced continuously; most liquid sub-category',
      "PSA-Graded Cards: PSA authentication eliminates counterparty risk on grading; population report verified before acquisition; pricing via PWCC Marketplace, eBay 'sold' listings, or Heritage/Goldin auction results; storage in PSA-approved climate-controlled holders; no sub-category to exceed 3% of portfolio without IC approval",
      'IC thresholds across all sub-categories: notify IC above C$100K; formal IC approval above C$250K; full investment memo above C$500K',
    ],
    actions: [
      { title: 'Confirm all Monetary Hedge holdings are covered under a scheduled personal articles insurance policy at current appraised values — separate policy from home insurance', priority: 'Immediate', ownerText: 'Reg / Ross', due: 'Q3 2026' },
      { title: "Document the arms-length protocol for all transactions between Ross's watch firm and Reg's collection: independent market reference required; IC notification before completion", priority: 'Immediate', ownerText: 'Ross / IC', due: 'Q3 2026' },
      { title: 'Formally transition personal gold and card positions to portfolio assets: agree opening valuation basis with EY (tax) and PQ (equalization)', priority: 'Immediate', ownerText: 'Reg / EY / PQ', due: 'Q3 2026' },
      { title: 'Establish a PSA account for ongoing grading submissions if cards are to be held as portfolio assets; agree grading standard threshold (PSA 8+ for vintage sports cards as a minimum)', priority: 'Active', ownerText: 'Ross', due: '' },
      { title: "Agree Ross's watch firm valuation methodology with PQ for equalization purposes: private business valuation, not collectible", priority: 'Active', ownerText: 'Ross / PQ', due: 'Q4 2026' },
      { title: 'Annual independent appraisal of all Monetary Hedge physical assets (watches and cards) before year-end equalization — agree appraiser(s) for each sub-category', priority: 'Monitor', ownerText: 'Ross / Reg', due: 'Q4 2026' },
      { title: 'Confirm Monetary Hedge sub-category concentration: no single sub-category to exceed 3% of portfolio; confirm the current watch position does not already breach this', priority: 'Active', ownerText: 'Ross / Reg', due: '' },
    ],
  },
];

// The register's effective date (Cover sheet) — used as assessed_at on the seeded
// baseline assessment for every category.
const EFFECTIVE_DATE = '2026-06-01T00:00:00.000Z';
const SEED_ASSESSOR_ID = 'reg';

module.exports = { DOMAINS, SCALE, IPS_CONTEXT, CATEGORIES, EFFECTIVE_DATE, SEED_ASSESSOR_ID };
