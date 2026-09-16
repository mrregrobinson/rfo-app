// Builds the "Print / PDF" report for the Maturity Assessment module.
//
// Same stack as server/risk-report.js / server/expenditure-report.js: pdfkit (draw-based)
// + chartjs-node-canvas (real Chart.js image via node-canvas, no headless browser).
// See RFO_Maturity_App_BuildSpec_v1 §8. This is the initial version — cover, radar,
// scorecard by category, Capital Consciousness profile, and open actions.
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { FONT_FAMILY, registerChartFonts } = require('./chart-fonts');

// The chart's canvas has to be sized to the number of services being plotted (up to 16) —
// a fixed small canvas is what made this chart read as a cramped smudge next to the crisp
// per-service text below it. Instances are cheap to reuse, so cache by exact size instead
// of re-registering fonts on every report.
const canvasCache = new Map();
function getChartCanvas(width, height) {
  const key = width + 'x' + height;
  let c = canvasCache.get(key);
  if (!c) {
    c = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: 'white',
      chartCallback: (ChartJS) => { ChartJS.defaults.font.family = FONT_FAMILY; },
    });
    registerChartFonts(c);
    canvasCache.set(key, c);
  }
  return c;
}

// Draws the numeric value beside each bar — the same thing that makes the on-screen
// Lollipop chart (public/maturity.html) legible at a glance instead of relying on the
// reader to eyeball bar length against the axis.
const valueLabelPlugin = {
  id: 'maturityValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `bold 12px "${FONT_FAMILY}"`;
    ctx.fillStyle = '#1B2A4A';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, di) => {
      chart.getDatasetMeta(di).data.forEach((bar, i) => {
        const v = ds.data[i];
        if (v == null) return;
        ctx.fillText(String(v), bar.x + 6, bar.y);
      });
    });
    ctx.restore();
  },
};

// Grouped horizontal bar: one row per assessed service. Family mean is always shown;
// Claude's own independent read of where the family sits (assessedLevel) and Claude's
// researched peer benchmark (peerLevel) are added only when showBenchmark is true — the
// same "Show benchmark" choice as the Scorecard tab's on-screen chart, carried into the
// exported report.
async function barPng(model, showBenchmark) {
  const services = model.services.filter((s) => s.stats && s.stats.mean != null);
  if (!services.length) return null;
  const datasets = [
    { label: 'Family mean', data: services.map((s) => s.stats.mean), backgroundColor: 'rgba(27,42,74,0.85)', barPercentage: 0.7, categoryPercentage: 0.8 },
  ];
  if (showBenchmark) {
    datasets.push(
      { label: "Claude's read of us", data: services.map((s) => (s.benchmark ? s.benchmark.assessedLevel : null)), backgroundColor: 'rgba(42,125,123,0.85)', barPercentage: 0.7, categoryPercentage: 0.8 },
      { label: 'Claude benchmark (peers)', data: services.map((s) => (s.benchmark ? s.benchmark.peerLevel : null)), backgroundColor: 'rgba(201,168,76,0.85)', barPercentage: 0.7, categoryPercentage: 0.8 }
    );
  }
  const width = 980;
  const height = 150 + services.length * (showBenchmark ? 46 : 30);
  const canvas = getChartCanvas(width, height);
  return canvas.renderToBuffer({
    type: 'bar',
    data: { labels: services.map((s) => `#${s.number} ${s.name}`), datasets },
    options: {
      indexAxis: 'y',
      layout: { padding: { right: 36 } },
      plugins: {
        legend: { display: showBenchmark, position: 'top', labels: { font: { size: 14 } } },
        title: {
          display: true, font: { size: 17 },
          text: showBenchmark
            ? "Maturity by service — family mean vs. Claude's read of us vs. peer benchmark (1–5)"
            : 'Maturity by service — family self-assessed mean (1–5)',
        },
      },
      scales: {
        x: { min: 0, max: 5, ticks: { stepSize: 1, font: { size: 13 } } },
        y: { ticks: { font: { size: 13 } } },
      },
    },
    plugins: [valueLabelPlugin],
  });
}

const NAVY = '#1B2A4A';
const TEAL = '#2A7D7B';
const INK = '#111111';
const SLATE = '#374151';
const MUTED = '#6B7280';
const HAIRLINE = '#D9DCE3';
const PRIORITY_COLOR = { Immediate: '#9D174D', Active: '#B45309', Monitor: '#1E3A8A', Maintain: '#065F46' };

const MARGIN = { top: 66, bottom: 58, left: 50, right: 50 };
const PAGE_TITLE = 'Robinson Family Office — Maturity Assessment';

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(2));

// A fresh page for every major section, a consistent title treatment (rule, not the cheap
// text-underline pdfkit draws hugging the descenders), and a hairline back at the left
// margin — this is what separates "internal working doc" from something a provider opens.
function sectionHeader(doc, title, { breakBefore = true } = {}) {
  if (breakBefore) doc.addPage();
  doc.x = MARGIN.left;
  doc.fontSize(16).font('Helvetica-Bold').fillColor(NAVY).text(title, { width: doc.page.width - MARGIN.left - MARGIN.right });
  doc.moveDown(0.2);
  const y = doc.y;
  doc.moveTo(MARGIN.left, y).lineTo(doc.page.width - MARGIN.right, y).lineWidth(1).strokeColor(HAIRLINE).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fillColor(INK);
}

function subHeader(doc, title) {
  doc.x = MARGIN.left;
  doc.fontSize(12.5).font('Helvetica-Bold').fillColor(TEAL).text(title.toUpperCase(), { characterSpacing: 0.4 });
  doc.moveDown(0.25);
  doc.font('Helvetica').fillColor(INK);
}

// Four label-over-value stat cards, evenly spaced — a quick executive read of the round
// before the reader gets to sixteen services of detail.
function statStrip(doc, stats) {
  const width = doc.page.width - MARGIN.left - MARGIN.right;
  const colW = width / stats.length;
  const top = doc.y;
  stats.forEach((s, i) => {
    const x = MARGIN.left + i * colW;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text(s.label.toUpperCase(), x, top, { width: colW - 10, characterSpacing: 0.3 });
    doc.fontSize(22).font('Helvetica-Bold').fillColor(NAVY).text(s.value, x, top + 13, { width: colW - 10 });
  });
  doc.font('Helvetica').fillColor(INK);
  doc.y = top + 46;
  doc.x = MARGIN.left;
}

// Real bullets with hanging indents (pdfkit's list()), not text lines prefixed with a
// character — the latter looks fine for one line and collapses the moment an item wraps.
// pdfkit draws each item's bullet dot and its text in whatever the fill colour is at that
// moment, both set here, so bullet and text always share one colour per call.
function bullets(doc, items, { color = SLATE, fontSize = 9.5 } = {}) {
  if (!items || !items.length) return;
  doc.fontSize(fontSize).font('Helvetica').fillColor(color);
  doc.list(items, MARGIN.left + 10, doc.y, {
    width: doc.page.width - MARGIN.left - MARGIN.right - 10,
    bulletRadius: 1.6,
    textIndent: 14,
    bulletIndent: 0,
  });
  // list() leaves doc.x at its own start position (MARGIN.left + 10) rather than the page
  // margin, which would otherwise creep every paragraph after a bullet list rightward.
  doc.x = MARGIN.left;
  doc.fillColor(color);
}

async function buildMaturityReportPdf(model, opts = {}) {
  const showBenchmark = opts.showBenchmark !== false;
  const { round, groups, levelLabels, services, consciousness, consciousnessLevels, actions, generatedAt } = model;
  const ccName = (lvl) => (consciousnessLevels || []).find((l) => l.level === Math.round(lvl))?.name || '';
  const doc = new PDFDocument({ margins: MARGIN, size: 'LETTER', bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const labelName = (lvl) => (levelLabels.find((l) => l.level === Math.round(lvl)) || {}).name || '';

  // ---- Cover ----------------------------------------------------------------------
  doc.fontSize(20).font('Helvetica-Bold').fillColor(NAVY).text('Robinson Family Office');
  doc.fontSize(15).font('Helvetica').fillColor(TEAL).text('Maturity Assessment');
  doc.moveDown(0.5);
  doc.moveTo(MARGIN.left, doc.y).lineTo(doc.page.width - MARGIN.right, doc.y).lineWidth(1.5).strokeColor(NAVY).stroke();
  doc.moveDown(0.6);
  doc.fontSize(12).font('Helvetica-Bold').fillColor(INK).text(round ? round.label + (round.isAnchor ? '  ·  Baseline anchor' : '') : 'No round selected');
  doc.fontSize(10).font('Helvetica').fillColor(MUTED).text(
    (round ? 'Status: ' + round.status + '   ·   ' : '') + `Generated ${new Date(generatedAt).toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short' })}`
  );
  doc.moveDown(1.1);

  const scored = services.filter((s) => s.stats && s.stats.mean != null);
  const famMean = scored.length ? scored.reduce((a, s) => a + s.stats.mean, 0) / scored.length : null;
  const benched = services.filter((s) => s.benchmark);
  const peerMean = benched.length ? benched.reduce((a, s) => a + s.benchmark.peerLevel, 0) / benched.length : null;
  const assessed = services.filter((s) => s.benchmark && s.benchmark.assessedLevel != null);
  const assessedMean = assessed.length ? assessed.reduce((a, s) => a + s.benchmark.assessedLevel, 0) / assessed.length : null;
  const coverStats = [
    { label: 'Family mean', value: fmt(famMean) },
    ...(showBenchmark ? [
      { label: "Claude's read of us", value: fmt(assessedMean) },
      { label: 'Peer benchmark', value: fmt(peerMean) },
    ] : []),
    { label: 'Services assessed', value: `${scored.length}/${services.length}` },
  ];
  statStrip(doc, coverStats);
  doc.moveDown(1);
  doc.fontSize(9).font('Helvetica').fillColor(MUTED).text('Confidential — prepared for the Robinson Family Office and its advisors.');

  // ---- Chart, on its own page, sized to the number of services actually plotted ----
  // Cramming it above the per-service text (its old spot) left too little height per row
  // to read clearly, which is why it used to look murkier than the plain text below it.
  sectionHeader(doc, 'Maturity by service — at a glance');
  try {
    const img = await barPng(model, showBenchmark);
    if (img) {
      doc.image(img, { fit: [doc.page.width - MARGIN.left - MARGIN.right, 660], align: 'center' });
    } else {
      doc.fontSize(9).fillColor(MUTED).text('No services assessed yet this round.');
    }
  } catch (err) {
    doc.fontSize(9).fillColor('#991B1B').text(`(chart could not be rendered: ${err.message})`);
  }

  // ---- Scorecard by category — one page per group for a clean, provider-ready layout
  let firstGroup = true;
  for (const g of groups) {
    const rows = services.filter((s) => s.groupId === g.id);
    if (!rows.length) continue;
    if (firstGroup) { sectionHeader(doc, 'Scorecard by service'); firstGroup = false; }
    else doc.addPage();
    subHeader(doc, g.name);
    doc.fontSize(9.5).fillColor(INK);
    let firstService = true;
    for (const s of rows) {
      if (doc.y > 690) doc.addPage();
      if (!firstService) {
        doc.moveTo(MARGIN.left, doc.y).lineTo(doc.page.width - MARGIN.right, doc.y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
        doc.moveDown(0.4);
      }
      firstService = false;
      const mean = s.stats && s.stats.mean != null ? s.stats.mean : null;
      const bench = s.benchmark ? s.benchmark.peerLevel : null;
      const assessedLvl = s.benchmark ? s.benchmark.assessedLevel : null;
      const gap = mean != null && bench != null ? (bench - mean) : null;
      doc.font('Helvetica-Bold').fontSize(10.5).text(`#${s.number}  ${s.name}`);
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(9.5).lineGap(2).fillColor(SLATE).text(
        mean != null
          ? `Family mean ${fmt(mean)} (${labelName(mean)})   ·   min ${s.stats.min} / max ${s.stats.max} / spread ${s.stats.spread}`
          : 'Not assessed this round'
      );
      if (showBenchmark && assessedLvl != null) {
        doc.moveDown(0.3);
        doc.fillColor(INK).text(`Claude's read of us: ${fmt(assessedLvl)} (${labelName(assessedLvl)})`);
        if (s.benchmark.assessedRationale) { doc.moveDown(0.1); doc.fillColor(SLATE).text(s.benchmark.assessedRationale); }
      }
      if (showBenchmark && bench != null) {
        doc.moveDown(0.3);
        doc.fillColor(INK).text(`Claude benchmark (peers) ${fmt(bench)} (${labelName(bench)})` + (gap != null ? `   ·   gap vs family ${gap > 0 ? '+' : ''}${gap.toFixed(1)}` : ''));
        if (s.benchmark.peerRationale) { doc.moveDown(0.1); doc.fillColor(SLATE).text(s.benchmark.peerRationale); }
        if (s.benchmark.recommendedPriority) {
          const pc = PRIORITY_COLOR[s.benchmark.recommendedPriority] || INK;
          doc.moveDown(0.25);
          doc.font('Helvetica-Bold').fillColor(pc).text(`${s.benchmark.recommendedPriority}. `, { continued: !!s.benchmark.recommendation })
            .font('Helvetica').fillColor(SLATE).text(s.benchmark.recommendation || '');
        }
        if ((s.benchmark.whatWouldMoveUp || []).length) {
          doc.moveDown(0.25);
          bullets(doc, s.benchmark.whatWouldMoveUp, { color: SLATE, fontSize: 9 });
        }
      }
      const per = (s.scores || []).filter((x) => x.submitted).map((x) => `${x.name.split(' ')[0]} ${x.level}`);
      if (per.length) { doc.moveDown(0.3); doc.fontSize(8.5).fillColor(MUTED).text('By member — ' + per.join('   ·   ')); }
      doc.fillColor(INK).lineGap(0).moveDown(0.7);
    }
  }

  // Capital Consciousness — a standalone, once-per-round family-wide read (not tied to
  // any one service): what level of awareness the family is currently deciding from.
  sectionHeader(doc, 'Capital Consciousness — what level the family is deciding from');
  doc.fontSize(9.5).fillColor(INK);
  const cc = (consciousness && consciousness.summary) || {};
  const ccPrev = (consciousness && consciousness.prevSummary) || {};
  if (cc.cog != null) {
    doc.font('Helvetica-Bold').text(`Family centre of gravity: level ${cc.cog} (${ccName(cc.cog)})` + (ccPrev.cog != null ? `  (was ${ccPrev.cog})` : ''));
    doc.moveDown(0.2);
    doc.font('Helvetica').lineGap(2).fillColor(SLATE).text(
      `Range ${cc.min}–${cc.max} across ${cc.count} member${cc.count === 1 ? '' : 's'}, spread ${cc.spread}` +
      (cc.straddlesThreshold ? ' — members on both sides of the Level-4 threshold' : '')
    );
    doc.fillColor(INK).lineGap(0).moveDown(0.5);
    if ((cc.members || []).length) {
      bullets(doc, cc.members.map((m) => `${m.name}: level ${m.level}` + (m.note ? ` — “${m.note}”` : '')), { color: SLATE });
    }
  } else {
    doc.fillColor(MUTED).text('No Capital Consciousness answers recorded this round.').fillColor(INK);
  }

  if (round && round.synthesis) {
    const syn = round.synthesis;
    doc.moveDown(0.7);
    doc.moveTo(MARGIN.left, doc.y).lineTo(doc.page.width - MARGIN.right, doc.y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    doc.moveDown(0.6);
    subHeader(doc, 'Round synthesis');
    doc.fontSize(9.5).lineGap(2).fillColor(INK);
    if (syn.doingThingsRight) { doc.font('Helvetica-Bold').text('Doing things right. ', { continued: true }).font('Helvetica').text(syn.doingThingsRight); doc.moveDown(0.35); }
    if (syn.doingTheRightThings) { doc.font('Helvetica-Bold').text('Doing the right things. ', { continued: true }).font('Helvetica').text(syn.doingTheRightThings); doc.moveDown(0.35); }
    doc.lineGap(0);
    if ((syn.priorities || []).length) { bullets(doc, syn.priorities, { color: SLATE }); }
    doc.fillColor(INK);
  }

  // ---- Open actions -----------------------------------------------------------------
  sectionHeader(doc, 'Open actions');
  const open = (actions || []).filter((a) => a.effectiveStatus !== 'done' && !a.archivedAt);
  let firstBucket = true;
  for (const bucket of ['Immediate', 'Active', 'Monitor']) {
    if (!firstBucket) {
      doc.moveTo(MARGIN.left, doc.y).lineTo(doc.page.width - MARGIN.right, doc.y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
      doc.moveDown(0.5);
    }
    firstBucket = false;
    const list = open.filter((a) => a.priority === bucket);
    const bc = { Immediate: '#9D174D', Active: '#B45309', Monitor: '#1E9E5A' }[bucket];
    doc.fontSize(11).font('Helvetica-Bold').fillColor(bc).text(`${bucket} (${list.length})`);
    doc.moveDown(0.25);
    if (!list.length) {
      doc.fontSize(9.5).font('Helvetica').fillColor(MUTED).text('None.');
    } else {
      bullets(doc, list.map((a) => {
        const svc = services.find((s) => s.id === a.serviceId);
        const link = a.taskId && a.task && !a.task.deleted ? '  [Task List]' : '';
        return `${svc ? '#' + svc.number + ' ' + svc.name + ' — ' : ''}${a.title}${a.ownerText ? '  (' + a.ownerText + ')' : ''}${a.dueQuarter ? '  ' + a.dueQuarter : ''}${link}`;
      }), { color: SLATE, fontSize: 9.5 });
    }
    doc.moveDown(0.5);
  }

  // ---- Running header + footer with page numbers, applied to every page after the fact
  // The footer sits inside the bottom margin band, below pdfkit's own auto-pagination
  // boundary (page.height - margins.bottom) — writing there via .text(), even with an
  // explicit y, makes pdfkit think the content overflowed and silently starts a *new*
  // page instead of drawing on the current one. Zeroing the margin for the duration of
  // the footer draw is pdfkit's own documented workaround for this.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pageNum = i - range.start + 1;
    const bottom = doc.page.height - MARGIN.bottom + 18;
    const realBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGIN.left, bottom).lineTo(doc.page.width - MARGIN.right, bottom).lineWidth(0.75).strokeColor(HAIRLINE).stroke();
    doc.fontSize(8).font('Helvetica').fillColor(MUTED)
      .text('Confidential — Robinson Family Office', MARGIN.left, bottom + 6, { width: 300, lineBreak: false })
      .text(`Page ${pageNum} of ${range.count}`, doc.page.width - MARGIN.right - 150, bottom + 6, { width: 150, align: 'right', lineBreak: false });
    doc.page.margins.bottom = realBottomMargin;
    if (pageNum > 1) {
      doc.fontSize(8).fillColor(MUTED)
        .text(PAGE_TITLE, MARGIN.left, 30, { width: 300, lineBreak: false })
        .text(round ? round.label : '', doc.page.width - MARGIN.right - 250, 30, { width: 250, align: 'right', lineBreak: false });
    }
  }

  doc.end();
  return done;
}

module.exports = { buildMaturityReportPdf };
