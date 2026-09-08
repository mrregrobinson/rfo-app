// Builds the "Print" / "Email as PDF" report for the Risk Management module.
//
// Same stack and reasoning as server/expenditure-report.js: pdfkit (draw-based) +
// chartjs-node-canvas (renders a real Chart.js image via node-canvas, no headless
// browser) — appropriate for a low-frequency report export inside a shared single Node
// process. See RFO_Risk_App_BuildSpec_v1 §8.
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { FONT_FAMILY, registerChartFonts } = require('./chart-fonts');

const chartCanvas = new ChartJSNodeCanvas({
  width: 520,
  height: 360,
  backgroundColour: 'white',
  chartCallback: (ChartJS) => { ChartJS.defaults.font.family = FONT_FAMILY; },
});
registerChartFonts(chartCanvas);

// Mirrors server/risk.js's scoreOf/bandOf — kept local so the report never diverges.
const scoreOf = (p, i) => (Number(p) || 0) * (Number(i) || 0);
const bandOf = (s) => (s <= 5 ? 'Low' : s <= 8 ? 'Medium' : 'High');
const BAND_COLOR = { Low: '#1E9E5A', Medium: '#B45309', High: '#9D174D' };

async function heatmapPng(rows, useInherent) {
  // One point per assessed category at its P (x) / I (y). Jitter co-located points a
  // little so overlaps are visible.
  const seen = {};
  const data = [];
  for (const r of rows) {
    if (!r.assessment) continue;
    const p = useInherent ? r.assessment.inherentProb : r.assessment.residualProb;
    const i = useInherent ? r.assessment.inherentImpact : r.assessment.residualImpact;
    const key = `${p},${i}`;
    const n = (seen[key] = (seen[key] || 0) + 1);
    const off = (n - 1) * 0.12;
    data.push({ x: p + off, y: i + off, label: `#${r.category.number}`, band: bandOf(scoreOf(p, i)) });
  }
  return chartCanvas.renderToBuffer({
    type: 'scatter',
    data: {
      datasets: [{
        label: useInherent ? 'Inherent' : 'Residual',
        data,
        pointRadius: 9,
        pointBackgroundColor: data.map((d) => BAND_COLOR[d.band]),
        pointBorderColor: '#fff',
        pointBorderWidth: 1,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${useInherent ? 'Inherent' : 'Residual'} risk heatmap (Probability × Impact)` },
      },
      scales: {
        x: { min: 0.5, max: 4.5, ticks: { stepSize: 1, callback: (v) => (Number.isInteger(v) && v >= 1 && v <= 4 ? v : '') }, title: { display: true, text: 'Probability' } },
        y: { min: 0.5, max: 4.5, ticks: { stepSize: 1, callback: (v) => (Number.isInteger(v) && v >= 1 && v <= 4 ? v : '') }, title: { display: true, text: 'Impact' } },
      },
    },
  });
}

function fmtCAD(n) {
  if (n == null) return '—';
  return (n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

async function buildRiskReportPdf(model) {
  const { domains, rows, events, residualExposure, inherentExposure, generatedAt, filters } = model;
  const doc = new PDFDocument({ margin: 44, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).fillColor('#1B2A4A').text('Robinson Family Office — Enterprise Risk Register');
  doc.fontSize(10).fillColor('#6B7280').text(`Generated ${new Date(generatedAt).toLocaleString('en-CA')}`);
  const fbits = [];
  if (filters.domain) fbits.push(`domains ${filters.domain}`);
  if (filters.status) fbits.push(`status ${filters.status}`);
  if (filters.band) fbits.push(`band ${filters.band}`);
  if (filters.accountable) fbits.push(`accountable ~ "${filters.accountable}"`);
  doc.text(fbits.length ? `Filters: ${fbits.join('; ')}` : 'Filters: none (full register)');
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#111').text(
    `Aggregate residual exposure: ${residualExposure}  (inherent: ${inherentExposure})   ·   ${rows.length} risk categor${rows.length === 1 ? 'y' : 'ies'}`
  );
  doc.moveDown(0.5);

  try {
    const img = await heatmapPng(rows, false);
    doc.image(img, { fit: [500, 340] });
  } catch (err) {
    doc.fontSize(9).fillColor('#991B1B').text(`(heatmap could not be rendered: ${err.message})`);
  }
  doc.moveDown(0.5);

  for (const d of domains) {
    const dRows = rows.filter((r) => r.category.domain_id === d.id);
    if (!dRows.length) continue;
    if (doc.y > 640) doc.addPage();
    doc.fontSize(12).fillColor('#2A7D7B').text(`${d.id}. ${d.name}`, { underline: true });
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#111');
    for (const r of dRows) {
      if (doc.y > 720) doc.addPage();
      const a = r.assessment;
      const inh = a ? `${a.inherentProb}×${a.inherentImpact}=${a.inherentScore} ${a.inherentBand}` : '—';
      const resd = a ? `${a.residualProb}×${a.residualImpact}=${a.residualScore} ${a.residualBand}` : 'not yet assessed';
      doc.font('Helvetica-Bold').text(`#${r.category.number}  ${r.category.title}`);
      doc.font('Helvetica').fillColor('#374151').text(r.category.description);
      doc.fillColor('#111').text(`Inherent ${inh}   |   Residual ${resd}   |   ${a ? a.status : ''}`);
      doc.fillColor('#6B7280').text(`Accountable: ${r.category.accountable || '—'}   |   Next review: ${a && a.nextReview ? a.nextReview : '—'}`);
      doc.moveDown(0.35);
    }
    doc.moveDown(0.2);
  }

  // Open actions grouped by priority bucket
  doc.addPage();
  doc.fontSize(13).fillColor('#1B2A4A').text('Open actions by priority', { underline: true });
  doc.moveDown(0.3);
  const allActions = [];
  for (const r of rows) for (const a of r.actions) if (a.effectiveStatus !== 'done') allActions.push({ ...a, categoryNumber: r.category.number, categoryTitle: r.category.title });
  for (const bucket of ['Immediate', 'Active', 'Monitor']) {
    const list = allActions.filter((a) => a.priority === bucket);
    doc.fontSize(11).fillColor(bucket === 'Immediate' ? '#9D174D' : bucket === 'Active' ? '#B45309' : '#1E9E5A').text(`${bucket} (${list.length})`);
    doc.fontSize(9).fillColor('#111');
    if (!list.length) doc.fillColor('#6B7280').text('  none').fillColor('#111');
    for (const a of list) {
      if (doc.y > 720) doc.addPage();
      const link = a.taskId && a.task && !a.task.deleted ? ' [Task List]' : '';
      doc.text(`  #${a.categoryNumber}  ${a.title}${a.ownerText ? '  — ' + a.ownerText : ''}${a.dueQuarter ? '  (' + a.dueQuarter + ')' : ''}${link}`);
    }
    doc.moveDown(0.4);
  }

  // Events in the last 12 months
  doc.moveDown(0.3);
  if (doc.y > 660) doc.addPage();
  doc.fontSize(13).fillColor('#1B2A4A').text('Risk events — last 12 months', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#111');
  if (!events.length) doc.fillColor('#6B7280').text('  none logged').fillColor('#111');
  for (const e of events) {
    if (doc.y > 720) doc.addPage();
    doc.text(`  ${e.occurredOn}  #${e.categoryNumber}  ${e.title}  [${e.severity}]  ${fmtCAD(e.financialImpactCad)}  — ${e.status}`);
  }

  doc.end();
  return done;
}

module.exports = { buildRiskReportPdf };
