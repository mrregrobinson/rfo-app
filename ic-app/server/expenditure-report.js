// Builds the "Print" / "Email as PDF" report for the Household Expenditure app.
//
// Deliberately pdfkit (draw-based) + chartjs-node-canvas (renders the same Chart.js
// config the on-screen view uses, via node-canvas — no headless browser) rather than
// Puppeteer: this app runs inside the same single Node process as Due
// Diligence/Tasks/Meetings on one shared host, and a headless-Chrome memory spike on
// every export is a shared-process cost a low-frequency, two-user report export doesn't
// justify. See RFO_Expenditure_App_BuildSpec_v1.md's Export section.
//
// One report type is rendered per call — matching the on-screen Charts card, which also
// shows one chart at a time (see CHART_TYPES/ChartsCard in public/expenditure.html) —
// rather than always bundling every chart plus the full transaction list into one PDF.
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { FONT_FAMILY, registerChartFonts } = require('./chart-fonts');

const chartCanvas = new ChartJSNodeCanvas({
  width: 520,
  height: 260,
  backgroundColour: 'white',
  chartCallback: (ChartJS) => { ChartJS.defaults.font.family = FONT_FAMILY; },
});
registerChartFonts(chartCanvas);

function fmtCAD(n) {
  return (n || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
}

// Mirrors bucketByPeriod/trailingTwelveMonthTotals in public/expenditure.html — the PDF
// needs the exact same re-bucketed shape the on-screen chart of the same type shows.
function monthKeysBetween(startKey, endKey) {
  let [y, m] = startKey.split('-').map(Number);
  const [endY, endM] = endKey.split('-').map(Number);
  const keys = [];
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return keys;
}
function bucketByPeriod(byMonth, granularity) {
  if (granularity === 'month') return byMonth || {};
  const result = {};
  Object.entries(byMonth || {}).forEach(([monthKey, amount]) => {
    const [year, month] = monthKey.split('-').map(Number);
    const key = granularity === 'year' ? String(year) : `${year} Q${Math.ceil(month / 3)}`;
    result[key] = (result[key] || 0) + amount;
  });
  return result;
}
function trailingTwelveMonthTotals(byMonth) {
  const dataKeys = Object.keys(byMonth || {}).sort();
  if (dataKeys.length === 0) return {};
  const allMonths = monthKeysBetween(dataKeys[0], dataKeys[dataKeys.length - 1]);
  if (allMonths.length < 12) return {};
  const values = allMonths.map((k) => byMonth[k] || 0);
  const result = {};
  for (let i = 11; i < allMonths.length; i++) {
    let sum = 0; for (let j = i - 11; j <= i; j++) sum += values[j];
    result[allMonths[i]] = sum;
  }
  return result;
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

async function lineChartPng(byMonth) {
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

async function barChartPng(byBucket) {
  const keys = Object.keys(byBucket).sort();
  return chartCanvas.renderToBuffer({
    type: 'bar',
    data: {
      labels: keys,
      datasets: [{ label: 'Spend (CAD)', data: keys.map((k) => byBucket[k]), backgroundColor: '#2A7D7B' }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}

function periodLabel(r) {
  return `${r.dateFrom || 'earliest'} to ${r.dateTo || 'latest'}`;
}

async function renderCategorySection(doc, r, heading) {
  doc.fontSize(13).fillColor('#1B2A4A').text(heading || periodLabel(r));
  doc.fontSize(11).fillColor('#111').text(`Total: ${fmtCAD(r.summary.total)} across ${r.summary.count} transaction${r.summary.count === 1 ? '' : 's'}`);
  doc.moveDown(0.3);
  if (Object.keys(r.summary.byCategory).length === 0) {
    doc.fontSize(10).fillColor('#6B7280').text('No spending in this period.');
    doc.moveDown(0.5);
    return;
  }
  const img = await categoryChartPng(r.summary.byCategory);
  doc.image(img, { fit: [520, 260] });
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor('#1B2A4A').text('By category', { underline: true });
  doc.fontSize(10).fillColor('#111');
  Object.entries(r.summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([name, amount]) => {
    doc.text(`${name}: ${fmtCAD(amount)}`);
  });
  doc.moveDown(0.5);
}

async function renderTrendSection(doc, r, heading) {
  doc.fontSize(13).fillColor('#1B2A4A').text(heading || periodLabel(r));
  doc.fontSize(11).fillColor('#111').text(`Total: ${fmtCAD(r.summary.total)} across ${r.summary.count} transaction${r.summary.count === 1 ? '' : 's'}`);
  doc.moveDown(0.3);
  if (Object.keys(r.summary.byMonth).length < 2) {
    doc.fontSize(10).fillColor('#6B7280').text('Not enough months in this period to chart a trend.');
    doc.moveDown(0.5);
    return;
  }
  const img = await lineChartPng(r.summary.byMonth);
  doc.image(img, { fit: [520, 260] });
  doc.moveDown(0.5);
}

async function renderTrailing12Section(doc, trailing12Range) {
  const ttm = trailingTwelveMonthTotals(trailing12Range.summary.byMonth);
  const points = Object.keys(ttm);
  doc.fontSize(13).fillColor('#1B2A4A').text('Trailing 12 Months');
  if (points.length === 0) {
    doc.fontSize(10).fillColor('#6B7280').text('Needs at least 12 months of history before a rolling 12-month total can be shown.');
    return;
  }
  const latestMonth = points.sort()[points.length - 1];
  doc.fontSize(11).fillColor('#111').text(`As of ${latestMonth}: ${fmtCAD(ttm[latestMonth])} (rolling 12-month total)`);
  doc.moveDown(0.3);
  const img = await lineChartPng(ttm);
  doc.image(img, { fit: [520, 260] });
}

async function renderPeriodSection(doc, range, granularity) {
  doc.fontSize(13).fillColor('#1B2A4A').text(`By ${granularity === 'year' ? 'Year' : 'Quarter'}`);
  doc.fontSize(11).fillColor('#6B7280').text(periodLabel(range));
  doc.moveDown(0.3);
  if (Object.keys(range.summary.byMonth).length === 0) {
    doc.fontSize(10).fillColor('#6B7280').text('No data to summarize yet.');
    return;
  }
  const bucketed = bucketByPeriod(range.summary.byMonth, granularity);
  const img = await barChartPng(bucketed);
  doc.image(img, { fit: [520, 260] });
}

function renderTransactionsSection(doc, range) {
  doc.fontSize(13).fillColor('#1B2A4A').text('Transaction Report', { underline: true });
  doc.fontSize(11).fillColor('#6B7280').text(periodLabel(range));
  doc.fontSize(11).fillColor('#111').text(`Total: ${fmtCAD(range.summary.total)} across ${range.summary.count} transaction${range.summary.count === 1 ? '' : 's'}`);
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#111');
  for (const t of range.transactions) {
    if (doc.y > 720) doc.addPage();
    doc.text(`${t.txnDate}  ${t.description}  ${fmtCAD(t.amountCad)}  [${t.categoryName || 'Uncategorized'}]`);
  }
}

// `range`/`compareRange` are { dateFrom, dateTo, summary: {total, byCategory, byMonth,
// count}, transactions }. `compareRange` (Period B) only ever applies to the 'category'
// and 'trend' report types — matches CHART_TYPES' `comparable` flag client-side, since a
// trailing-12/quarter-year report doesn't have a meaningful two-period split. The
// transaction list always covers `range` (Period A) only, same as the on-screen table.
async function buildReportPdf({ ledgerName, reportType, range, compareRange, trailing12Range, periodGranularity }) {
  const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const TITLES = {
    category: 'Household Expenditure Report — By Category',
    trend: 'Household Expenditure Report — Monthly Trend',
    trailing12: 'Household Expenditure Report — Trailing 12 Months',
    period: 'Household Expenditure Report — By Quarter/Year',
    transactions: 'Household Expenditure Report — Transactions',
  };
  doc.fontSize(18).fillColor('#1B2A4A').text(TITLES[reportType] || TITLES.category, { align: 'left' });
  doc.fontSize(11).fillColor('#6B7280').text(ledgerName);
  doc.moveDown(0.5);

  if (reportType === 'trend') {
    await renderTrendSection(doc, range, compareRange ? `Period A: ${periodLabel(range)}` : null);
    if (compareRange) { doc.addPage(); await renderTrendSection(doc, compareRange, `Period B: ${periodLabel(compareRange)}`); }
  } else if (reportType === 'trailing12') {
    await renderTrailing12Section(doc, trailing12Range);
  } else if (reportType === 'period') {
    await renderPeriodSection(doc, range, periodGranularity || 'quarter');
  } else if (reportType === 'transactions') {
    renderTransactionsSection(doc, range);
  } else {
    await renderCategorySection(doc, range, compareRange ? `Period A: ${periodLabel(range)}` : null);
    if (compareRange) { doc.addPage(); await renderCategorySection(doc, compareRange, `Period B: ${periodLabel(compareRange)}`); }
  }

  doc.end();
  return done;
}

module.exports = { buildReportPdf };
