// Builds the "Print / PDF" report for the Maturity Assessment module.
//
// Same stack as server/risk-report.js / server/expenditure-report.js: pdfkit (draw-based)
// + chartjs-node-canvas (real Chart.js image via node-canvas, no headless browser).
// See RFO_Maturity_App_BuildSpec_v1 §8. This is the initial version — cover, radar,
// scorecard by category, Capital Consciousness profile, and open actions.
const PDFDocument = require('pdfkit');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { FONT_FAMILY, registerChartFonts } = require('./chart-fonts');

const chartCanvas = new ChartJSNodeCanvas({
  width: 560,
  height: 520,
  backgroundColour: 'white',
  chartCallback: (ChartJS) => { ChartJS.defaults.font.family = FONT_FAMILY; },
});
registerChartFonts(chartCanvas);

// Grouped horizontal bar: one row per assessed service, three reads on a 1–5 scale —
// family mean, Claude's own independent read of where the family sits (assessedLevel),
// and Claude's researched peer benchmark (peerLevel) — replaces the radar, clearer for
// 16 services.
async function barPng(model) {
  const services = model.services.filter((s) => s.stats && s.stats.mean != null);
  if (!services.length) return null;
  return chartCanvas.renderToBuffer({
    type: 'bar',
    data: {
      labels: services.map((s) => `#${s.number} ${s.name}`),
      datasets: [
        { label: 'Family mean', data: services.map((s) => s.stats.mean), backgroundColor: 'rgba(27,42,74,0.85)', barPercentage: 0.6 },
        { label: "Claude's read of us", data: services.map((s) => (s.benchmark ? s.benchmark.assessedLevel : null)), backgroundColor: 'rgba(42,125,123,0.85)', barPercentage: 0.6 },
        { label: 'Claude benchmark (peers)', data: services.map((s) => (s.benchmark ? s.benchmark.peerLevel : null)), backgroundColor: 'rgba(201,168,76,0.85)', barPercentage: 0.6 },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { position: 'top' }, title: { display: true, text: 'Maturity by service — family mean vs. Claude\'s read of us vs. peer benchmark (1–5)' } },
      scales: { x: { min: 0, max: 5, ticks: { stepSize: 1 } } },
    },
  });
}

async function buildMaturityReportPdf(model) {
  const { round, groups, levelLabels, services, consciousness, consciousnessLevels, actions, generatedAt } = model;
  const ccName = (lvl) => (consciousnessLevels || []).find((l) => l.level === Math.round(lvl))?.name || '';
  const doc = new PDFDocument({ margin: 44, size: 'LETTER' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const labelName = (lvl) => (levelLabels.find((l) => l.level === Math.round(lvl)) || {}).name || '';

  doc.fontSize(18).fillColor('#1B2A4A').text('Robinson Family Office — Maturity Assessment');
  doc.fontSize(11).fillColor('#374151').text(round ? round.label + (round.isAnchor ? '  (baseline anchor)' : '') + '  ·  ' + round.status : 'No round selected');
  doc.fontSize(10).fillColor('#6B7280').text(`Generated ${new Date(generatedAt).toLocaleString('en-CA')}`);
  doc.moveDown(0.4);

  const scored = services.filter((s) => s.stats && s.stats.mean != null);
  const famMean = scored.length ? scored.reduce((a, s) => a + s.stats.mean, 0) / scored.length : null;
  const benched = services.filter((s) => s.benchmark);
  const peerMean = benched.length ? benched.reduce((a, s) => a + s.benchmark.peerLevel, 0) / benched.length : null;
  const assessed = services.filter((s) => s.benchmark && s.benchmark.assessedLevel != null);
  const assessedMean = assessed.length ? assessed.reduce((a, s) => a + s.benchmark.assessedLevel, 0) / assessed.length : null;
  doc.fontSize(11).fillColor('#111').text(
    `Aggregate family mean: ${famMean != null ? famMean.toFixed(2) : '—'}` +
    `   ·   Aggregate Claude's read of us: ${assessedMean != null ? assessedMean.toFixed(2) : '—'}` +
    `   ·   Aggregate peer benchmark: ${peerMean != null ? peerMean.toFixed(2) : '—'}` +
    `   ·   ${scored.length}/${services.length} services assessed`
  );
  doc.moveDown(0.5);

  try {
    const img = await barPng(model);
    if (img) doc.image(img, { fit: [500, 460] });
  } catch (err) {
    doc.fontSize(9).fillColor('#991B1B').text(`(chart could not be rendered: ${err.message})`);
  }
  doc.moveDown(0.5);

  for (const g of groups) {
    const rows = services.filter((s) => s.groupId === g.id);
    if (!rows.length) continue;
    if (doc.y > 640) doc.addPage();
    doc.fontSize(12).fillColor('#2A7D7B').text(g.name, { underline: true });
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#111');
    for (const s of rows) {
      if (doc.y > 720) doc.addPage();
      const mean = s.stats && s.stats.mean != null ? s.stats.mean : null;
      const bench = s.benchmark ? s.benchmark.peerLevel : null;
      const assessedLvl = s.benchmark ? s.benchmark.assessedLevel : null;
      const gap = mean != null && bench != null ? (bench - mean) : null;
      doc.font('Helvetica-Bold').text(`#${s.number}  ${s.name}`);
      doc.font('Helvetica').fillColor('#374151').text(
        mean != null
          ? `Family mean ${mean} (${labelName(mean)})   ·   min ${s.stats.min} / max ${s.stats.max} / spread ${s.stats.spread}`
          : 'Not assessed this round'
      );
      if (assessedLvl != null) {
        doc.fillColor('#111').text(`Claude's read of us: ${assessedLvl} (${labelName(assessedLvl)})`);
        if (s.benchmark.assessedRationale) doc.fillColor('#374151').text(s.benchmark.assessedRationale);
      }
      if (bench != null) {
        doc.fillColor('#111').text(`Claude benchmark (peers) ${bench} (${labelName(bench)})` + (gap != null ? `   ·   gap vs family ${gap > 0 ? '+' : ''}${gap.toFixed(1)}` : ''));
        if (s.benchmark.peerRationale) doc.fillColor('#374151').text(s.benchmark.peerRationale);
        if (s.benchmark.recommendedPriority) {
          const pc = { Immediate: '#9D174D', Active: '#B45309', Monitor: '#1E3A8A', Maintain: '#065F46' }[s.benchmark.recommendedPriority] || '#111';
          doc.font('Helvetica-Bold').fillColor(pc).text(`${s.benchmark.recommendedPriority}. `, { continued: !!s.benchmark.recommendation })
            .font('Helvetica').fillColor('#374151').text(s.benchmark.recommendation || '');
        }
        for (const w of s.benchmark.whatWouldMoveUp || []) {
          if (doc.y > 730) doc.addPage();
          doc.fillColor('#374151').text(`   → ${w}`);
        }
      }
      const per = (s.scores || []).filter((x) => x.submitted).map((x) => `${x.name.split(' ')[0]} ${x.level}`);
      if (per.length) doc.fillColor('#6B7280').text('   by member — ' + per.join('   ·   '));
      doc.fillColor('#111').moveDown(0.35);
    }
    doc.moveDown(0.2);
  }

  // Capital Consciousness — a standalone, once-per-round family-wide read (not tied to
  // any one service): what level of awareness the family is currently deciding from.
  doc.addPage();
  doc.fontSize(13).fillColor('#1B2A4A').text('Capital Consciousness — what level the family is deciding from', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor('#111');
  const cc = (consciousness && consciousness.summary) || {};
  const ccPrev = (consciousness && consciousness.prevSummary) || {};
  if (cc.cog != null) {
    doc.font('Helvetica-Bold').text(`Family centre of gravity: level ${cc.cog} (${ccName(cc.cog)})` + (ccPrev.cog != null ? `  (was ${ccPrev.cog})` : ''));
    doc.font('Helvetica').fillColor('#374151').text(
      `Range ${cc.min}–${cc.max} across ${cc.count} member${cc.count === 1 ? '' : 's'}, spread ${cc.spread}` +
      (cc.straddlesThreshold ? ' — members on both sides of the Level-4 threshold' : '')
    );
    doc.fillColor('#111').moveDown(0.3);
    for (const m of (cc.members || [])) {
      if (doc.y > 720) doc.addPage();
      doc.fillColor('#374151').text(`   ${m.name}: level ${m.level}` + (m.note ? ` — “${m.note}”` : ''));
    }
  } else {
    doc.fillColor('#6B7280').text('No Capital Consciousness answers recorded this round.').fillColor('#111');
  }
  doc.fillColor('#111');

  if (round && round.synthesis) {
    const syn = round.synthesis;
    if (doc.y > 620) doc.addPage();
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor('#1B2A4A').text('Round synthesis', { underline: true });
    doc.fontSize(9).fillColor('#111');
    if (syn.doingThingsRight) { doc.font('Helvetica-Bold').text('Doing things right. ', { continued: true }).font('Helvetica').text(syn.doingThingsRight); }
    if (syn.doingTheRightThings) { doc.moveDown(0.2).font('Helvetica-Bold').text('Doing the right things. ', { continued: true }).font('Helvetica').text(syn.doingTheRightThings); }
    for (const pr of syn.priorities || []) { if (doc.y > 730) doc.addPage(); doc.fillColor('#374151').text(`   • ${pr}`); }
    doc.fillColor('#111');
  }

  // Open actions
  doc.moveDown(0.4);
  if (doc.y > 660) doc.addPage();
  doc.fontSize(13).fillColor('#1B2A4A').text('Open actions', { underline: true });
  doc.moveDown(0.2);
  const open = (actions || []).filter((a) => a.effectiveStatus !== 'done' && !a.archivedAt);
  for (const bucket of ['Immediate', 'Active', 'Monitor']) {
    const list = open.filter((a) => a.priority === bucket);
    doc.fontSize(11).fillColor(bucket === 'Immediate' ? '#9D174D' : bucket === 'Active' ? '#B45309' : '#1E9E5A').text(`${bucket} (${list.length})`);
    doc.fontSize(9).fillColor('#111');
    if (!list.length) doc.fillColor('#6B7280').text('  none').fillColor('#111');
    for (const a of list) {
      if (doc.y > 720) doc.addPage();
      const svc = services.find((s) => s.id === a.serviceId);
      const link = a.taskId && a.task && !a.task.deleted ? ' [Task List]' : '';
      doc.text(`  ${svc ? '#' + svc.number + ' ' + svc.name + ' — ' : ''}${a.title}${a.ownerText ? '  (' + a.ownerText + ')' : ''}${a.dueQuarter ? '  ' + a.dueQuarter : ''}${link}`);
    }
    doc.moveDown(0.3);
  }

  doc.end();
  return done;
}

module.exports = { buildMaturityReportPdf };
