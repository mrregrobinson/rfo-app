// Builds the "Print" / "Email as PDF" report for the Household Expenditure app.
//
// Deliberately pdfkit (draw-based) + chartjs-node-canvas (renders the same Chart.js
// config the on-screen view uses, via node-canvas — no headless browser) rather than
// Puppeteer: this app runs inside the same single Node process as Due
// Diligence/Tasks/Meetings on one shared host, and a headless-Chrome memory spike on
// every export is a shared-process cost a low-frequency, two-user report export doesn't
// justify. See RFO_Expenditure_App_BuildSpec_v1.md's Export section.
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const chartCanvas = new ChartJSNodeCanvas({ width: 520, height: 260, backgroundColour: 'white' });

function fmtCAD(n) {
  return (n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

async function categoryChartPng(byCategory) {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return chartCanvas.renderToBuffer({
    type: 'bar',
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{ label: 'Spend (CAD)', data: entries.map(([, v]) => v), backgroundColor: '#2A7D7B' }],
    },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } },
  });
}

async function trendChartPng(byMonth) {
  const months = Object.keys(byMonth).sort();
  return chartCanvas.renderToBuffer({
    type: 'line',
    data: {
      labels: months,
      datasets: [{ label: 'Spend (CAD)', data: months.map((m) => byMonth[m]), borderColor: '#1B2A4A', backgroundColor: 'rgba(27,42,74,0.15)', fill: true, tension: 0.2 }],
    },
    options: { plugins: { legend: { display: false } } },
  });
}

// `range` is { label, dateFrom, dateTo, summary: {total, byCategory, byMonth, count}, transactions }.
// A second `compareRange` (same shape) renders a side-by-side comparison report instead
// of a single-period one.
async function buildReportPdf({ ledgerName, range, compareRange }) {
  const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).fillColor('#1B2A4A').text('Household Expenditure Report', { align: 'left' });
  doc.fontSize(11).fillColor('#6B7280').text(ledgerName);
  doc.moveDown(0.5);

  async function renderRange(r, heading) {
    doc.fontSize(13).fillColor('#1B2A4A').text(heading || `${r.dateFrom || 'earliest'} to ${r.dateTo || 'latest'}`);
    doc.fontSize(11).fillColor('#111').text(`Total: ${fmtCAD(r.summary.total)} across ${r.summary.count} transaction${r.summary.count === 1 ? '' : 's'}`);
    doc.moveDown(0.3);

    if (Object.keys(r.summary.byCategory).length) {
      const catImg = await categoryChartPng(r.summary.byCategory);
      doc.image(catImg, { fit: [520, 260] });
      doc.moveDown(0.3);
    }
    if (Object.keys(r.summary.byMonth).length > 1) {
      const trendImg = await trendChartPng(r.summary.byMonth);
      doc.image(trendImg, { fit: [520, 220] });
      doc.moveDown(0.3);
    }

    doc.fontSize(11).fillColor('#1B2A4A').text('By category', { underline: true });
    doc.fontSize(10).fillColor('#111');
    Object.entries(r.summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([name, amount]) => {
      doc.text(`${name}: ${fmtCAD(amount)}`);
    });
    doc.moveDown(0.5);
  }

  await renderRange(range, compareRange ? `Period A: ${range.dateFrom || 'earliest'} to ${range.dateTo || 'latest'}` : null);
  if (compareRange) {
    doc.addPage();
    await renderRange(compareRange, `Period B: ${compareRange.dateFrom || 'earliest'} to ${compareRange.dateTo || 'latest'}`);
  }

  doc.addPage();
  doc.fontSize(13).fillColor('#1B2A4A').text('Transactions', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#111');
  for (const t of range.transactions) {
    if (doc.y > 720) doc.addPage();
    doc.text(`${t.txnDate}  ${t.description}  ${fmtCAD(t.amountCad)}  [${t.categoryName || 'Uncategorized'}]`);
  }

  doc.end();
  return done;
}

module.exports = { buildReportPdf };
