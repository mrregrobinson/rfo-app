// Registers a bundled TrueType font with node-canvas for chart rendering.
//
// Without this, chartjs-node-canvas asks the OS/fontconfig for a font to draw chart
// labels/legends/axis ticks with. That works fine in local dev (Windows/macOS always
// have system fonts), but Railway's container has none installed, so every piece of
// chart text silently rendered as a missing-glyph box (□) in production PDFs instead
// of throwing an error — easy to miss until someone actually opened an exported report.
// Bundling DejaVu Sans (via the dejavu-fonts-ttf package) and registering it explicitly
// means chart text renders correctly regardless of what fonts the host has.
const FONT_FAMILY = 'DejaVu Sans';

function registerChartFonts(chartCanvas) {
  chartCanvas.registerFont(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf'), { family: FONT_FAMILY });
  chartCanvas.registerFont(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'), { family: FONT_FAMILY, weight: 'bold' });
}

module.exports = { FONT_FAMILY, registerChartFonts };
