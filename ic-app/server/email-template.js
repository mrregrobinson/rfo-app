// Shared HTML email shell — navy header with a gold eyebrow label, a white rounded card
// body, teal section labels and CTA button — so every outbound email (Task List digest,
// Due Diligence notifications, Meetings invites/minutes) reads as the same product
// instead of each notification having its own ad hoc styling. Originated as the Meetings
// module's minutes email; pulled out here once the family asked for the rest of the
// app's emails to match it.
const BRAND = { navy: '#1B2A4A', teal: '#2A7D7B', gold: '#C9A84C', muted: '#6B7280', border: '#E5E7EB', bg: '#F9FAFB' };

function escapeHtml(text) {
  return String(text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// One bordered content block inside the card. Used once for a simple notification's
// body, or once per agenda item in the minutes email.
function contentRow(innerHtml) {
  return `<tr><td style="padding:18px 24px 4px;border-top:1px solid ${BRAND.border};">${innerHtml}</td></tr>`;
}

// A label/value block with a bottom border, for a single prominent fact right under the
// header — e.g. the minutes email's "Attendees" line.
function infoRow(label, value) {
  return `<tr><td style="padding:14px 24px;border-bottom:1px solid ${BRAND.border};">
    <div style="font-size:11px;font-weight:700;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px;">${escapeHtml(label)}</div>
    <div style="font-size:13px;color:#374151;">${value}</div>
  </td></tr>`;
}

function sectionLabel(label) {
  return `<div style="font-size:11px;font-weight:700;color:${BRAND.teal};text-transform:uppercase;letter-spacing:.4px;margin:12px 0 4px;">${escapeHtml(label)}</div>`;
}

function paragraph(html) {
  return `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#374151;">${html}</p>`;
}

function bulletList(itemsHtml) {
  if (itemsHtml.length === 0) return '';
  return `<ul style="margin:0 0 10px;padding-left:20px;font-size:13px;color:#374151;">${itemsHtml.map((i) => `<li style="margin-bottom:4px;">${i}</li>`).join('')}</ul>`;
}

// { eyebrow, title, subtitle, bodyRowsHtml, ctaText, ctaUrl, footerText } -> full email
// HTML. bodyRowsHtml is pre-built <tr><td>...</td></tr> rows (contentRow/infoRow above),
// left to the caller so each email's content shape stays flexible.
function emailShell({ eyebrow, title, subtitle, bodyRowsHtml, ctaText, ctaUrl, footerText }) {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 0;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;font-family:-apple-system,Segoe UI,Arial,sans-serif;">
      <tr><td style="background:${BRAND.navy};padding:20px 24px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${BRAND.gold};margin-bottom:6px;">Robinson Family Office · ${escapeHtml(eyebrow)}</div>
        <div style="font-size:19px;font-weight:700;color:#ffffff;">${escapeHtml(title)}</div>
        ${subtitle ? `<div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:4px;">${escapeHtml(subtitle)}</div>` : ''}
      </td></tr>
      ${bodyRowsHtml}
      <tr><td style="padding:20px 24px;background:${BRAND.bg};">
        ${ctaUrl ? `<a href="${ctaUrl}" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 18px;border-radius:7px;">${escapeHtml(ctaText)}</a>` : ''}
        ${footerText ? `<div style="font-size:11px;color:${BRAND.muted};margin-top:${ctaUrl ? '14px' : '0'};">${footerText}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

module.exports = { BRAND, escapeHtml, contentRow, infoRow, sectionLabel, paragraph, bulletList, emailShell };
