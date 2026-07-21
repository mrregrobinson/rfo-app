// Snapshot of Family_Office_Task_List_2026 Q2.xlsx, transcribed once for the one-off
// import in scripts/import-tasks.js (Section 5.4 / 8.2 of the build spec). The source
// file lives outside this repo (in the family's Dropbox), so this is captured here
// rather than re-parsed from the spreadsheet at runtime.
//
// target: {quarter:'2026-Q3'} | {serial:45981} (an Excel date serial, converted to a
// real date at import time) | {ref:N} (a small number found in the Target Completion
// cell that isn't a parseable date or quarter — stashed as sourceRef instead, per the
// data-quality note in Section 5.4).
// sourceRef: the sheet's "Completion date" column value — a reference number back to
// the family's master tracker, NOT an actual completion date (see Section 5.4).

module.exports = [
  {
    category: 'accountability-succession',
    tasks: [
      { title: 'Refine RACI, and hold 1st meeting on Succession', assignees: ['RLR'], priority: 'H', target: { serial: 45981 } },
      { title: "Create a set of standard operating procedures (If I'm gone)", assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q3' } },
      { title: 'Refine the voluntary succession triggers - when for SD and R', assignees: ['RLR'], priority: 'H', target: { serial: 46035 } },
      { title: 'Adjust wording of inclusion for all four - RACI', assignees: ['RLR'], priority: 'H', target: { serial: 46035 } },
    ],
  },
  {
    category: 'risk-management',
    tasks: [
      { title: 'Add a global severe (and possibly catastrophic) event category to the Risk and resilience chart.', assignees: ['RLR'], priority: 'M', target: { serial: 45838 } },
      { title: 'Long Term Disability insurance in place', assignees: ['LJR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 17 },
      { title: 'Life insurance in place', assignees: ['LJR'], priority: 'H', target: { serial: 46027 } },
      { title: 'Confirm General and liability home and tenant insurance', assignees: ['ALL'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 20 },
      { title: 'Execute annual home and vehicle inspections and checklists', assignees: ['ALL'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Vehicle Safety kit', assignees: ['ALL'], priority: 'H', target: { serial: 46023 } },
      { title: 'Consolidated Family Emergency plan', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Confirm international travel health and emergency medical insurance for all family members', assignees: ['ALL'], priority: 'H', target: { serial: 46203 } },
      { title: 'Document Monetary Hedge storage and security protocols — safety deposit for watch collection; confirm insurer requirements', assignees: ['RLR', 'RWR'], priority: 'H', target: { serial: 46112 }, notes: 'Physical collection creates security exposure if location is known' },
    ],
  },
  { category: 'conflict-resolution', tasks: [] },
  { category: 'maturity', tasks: [] },
  {
    category: 'relationships',
    tasks: [
      { title: 'Investigating the PQ relationship programs', assignees: ['SDR'], priority: 'H', target: { serial: 45930 }, notes: 'Planning to use their retreat planners in 2026' },
      { title: 'Draft Cohabitation Agreement', assignees: ['RWR', 'LJR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 118 },
    ],
  },
  {
    category: 'learning',
    tasks: [
      { title: 'Draft a Learning Plan', assignees: ['SDR'], priority: 'H', target: { serial: 45930 }, notes: 'Being tabled at 2025 retreat' },
      { title: 'Plan 2026 Wellness Retreat', assignees: ['SDR'], priority: 'H', target: { serial: 38012 }, notes: 'Commitment made, Planning handed over to PQ' },
      { title: 'Add a capacity and capability reflection for Q3 council', assignees: ['SDR'], priority: 'H', target: { quarter: '2026-Q3' } },
    ],
  },
  {
    category: 'wellness',
    tasks: [
      { title: 'Draft caregiver plan, in the event of an emergency disability.', assignees: ['ALL'], priority: 'H', target: { serial: 46024 }, notes: 'Template uploaded to OnePassword' },
      { title: 'Review concierge level healthcare', assignees: ['LJR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 43 },
    ],
  },
  {
    category: 'investment',
    tasks: [
      { title: 'Consider adding currency as a category with next IPS review', assignees: ['RLR'], priority: 'H', target: { serial: 45838 }, notes: 'Discussed and decided that we should keep it outside PQ for now.' },
      { title: 'Consider taking on a higher risk profile, as Lucas and Ross have longer time horizon. - Ask PQ', assignees: ['RLR'], priority: 'H', target: { serial: 45838 }, notes: 'Moved asset allocation to be weighted more heavily toward private equity and reduced public equity' },
      { title: 'Finalize decision on PQ administration service', assignees: ['RLR'], priority: 'H', target: { serial: 45838 }, notes: 'Decision to keep administration in-house at least until EY consolidates companies.' },
      { title: 'Draft Policy and Procedures for Collectibles', assignees: ['RWR'], priority: 'H', target: { serial: 46024 }, notes: 'Initial drafts complete' },
      { title: 'Draft our PQ second level due diligence', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 46218, notes: "Discussion being tabled at Q2 meeting. Account for value alignment and 'Impact', limit FX exposure" },
      { title: 'Draft Policy Statement for Direct investments', assignees: ['RWR'], priority: 'M', target: null },
      { title: 'Revise IPS', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 131 },
      { title: 'Reduce fixed income overweight below 13% IPS maximum', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 66 },
      { title: 'Establish Monetary Hedge specialist relationships:', assignees: ['RWR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 120 },
      {
        title: 'Annual independent appraisal of all Monetary Hedge physical assets',
        assignees: ['RWR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 121,
        children: [
          { title: "Develop Ross's watch firm valuation methodology for equalization", assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 68 },
          { title: 'Assess each watch for risk of wearing', assignees: ['RWR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 129 },
        ],
      },
      { title: 'Leader Building sale', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 122 },
      { title: 'Prepare alternative advisor brief for Prime Quadrant and EY', assignees: ['RLR'], priority: 'M', target: { quarter: '2027-Q1' }, sourceRef: 70 },
      { title: 'Add legislative review - watches and general regulatory change', assignees: ['RWR'], priority: 'M', target: { quarter: '2027-Q1' }, sourceRef: 117 },
      { title: 'Ensure T1135 captures all offshore tax free interests.', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: "Document review for watches in RFO - including protocol for transactions between Ross's watch firm and R&SD's collection", assignees: ['RWR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 71 },
    ],
  },
  {
    category: 'philanthropy',
    tasks: [
      { title: 'Draft Philanthropy Policy Statement', assignees: ['RLR'], priority: 'H', target: { serial: 45662 }, notes: '2025 Draft discussed and adopted' },
      { title: 'Hold the first meeting decide on 2025 Grants', assignees: ['RLR'], priority: 'H', target: { serial: 45747 } },
      { title: 'Add a section to the PPS that strengthens impact and measurement of outcomes', assignees: ['SDR'], priority: 'H', target: { serial: 46035 } },
      { title: 'Add a section to the PPS that comments on how individual time effort may fold into overall family contribution', assignees: ['SDR'], priority: 'H', target: { serial: 46035 } },
    ],
  },
  {
    category: 'tax-estate',
    tasks: [
      { title: 'Introduce Estate lawyer to Ross and Lucas', assignees: ['RLR'], priority: 'H', target: { serial: 45838 }, notes: 'Introductions complete' },
      { title: 'Evaluate the need for a 3rd party trustee', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q3' } },
      { title: 'Complete and share Wills and Powers of Attorney', assignees: ['RWR'], priority: 'H', target: { ref: 125 } },
      { title: 'Ensure Wills and Living Estate reflects current asset structure', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 114 },
      { title: 'Document evaluation and POA activation and role transition protocol', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q3' }, sourceRef: 74 },
      { title: 'Evaluate preemptive role transfer from', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 127 },
      { title: 'Support Kim and Beisan with current wills and POAs', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 73 },
      { title: 'Confirm Monetary Hedge physical assets are addressed in estate documents', assignees: ['RLR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 72 },
      { title: 'Document 30-day governance and financial access protocol for any death scenario', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 75 },
    ],
  },
  {
    category: 'finance',
    tasks: [
      { title: 'Rebuild annual financial model to also include Home values', assignees: ['RLR'], priority: 'H', target: { serial: 45747 } },
      { title: 'Audit. Investigate the potential of a third party firm to audit and provide advice on controls.', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Spending reduction plan, to be triggered in a downturn.', assignees: ['ALL'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Review general family insurance requirements for risk and fraud losses', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Develop a tracking approach to cover Monetary Hedge costs', assignees: ['RLR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 78 },
    ],
  },
  {
    category: 'it',
    tasks: [
      { title: 'Cyber Security Training', assignees: ['SDR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 89 },
      { title: 'Internal Security Policy - passwords, encryption, network', assignees: ['RWR'], priority: 'H', target: { quarter: '2026-Q4' }, sourceRef: 62 },
      { title: 'External security audit and third party testing', assignees: ['RWR'], priority: 'M', target: { quarter: '2026-Q4' } },
      { title: 'Incident Response Plan', assignees: ['RWR'], priority: 'M', target: { quarter: '2026-Q4' }, sourceRef: 63 },
      { title: 'Confirm family external communication protocol for Monetary Hedge', assignees: ['SDR'], priority: 'M', target: { quarter: '2026-Q3' }, sourceRef: 79 },
    ],
  },
];
