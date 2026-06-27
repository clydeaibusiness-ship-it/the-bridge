/**
 * render.js — turns a finished issue into the email HTML (and a plain-text
 * fallback). Light, on-brand: cream, ink, gold; Playfair Display + DM Mono
 * feel. The same renderer feeds the public archive page later.
 *
 * Every source used to verify the story, plus the one human resource from
 * Section 2, is listed with a link at the bottom.
 */

const CREAM = '#f5f0e8';
const INK = '#1a1512';
const GOLD = '#c8a96e';
const MUTE = '#7a7570';
const LINE = '#e0d8c8';

function paragraphs(text, style) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Dedupe sources by domain, keep lean for a small label. */
function sourceLinks(sources = []) {
  const seen = new Set();
  const items = [];
  for (const s of sources) {
    if (!s.domain || seen.has(s.domain)) continue;
    seen.add(s.domain);
    items.push(
      `<a href="${s.url}" style="color:${MUTE};text-decoration:underline;">${escapeHtml(s.domain)}</a>${
        s.lean ? ` <span style="color:${LINE};">(${s.lean})</span>` : ''
      }`
    );
  }
  return items.join(' &nbsp;·&nbsp; ');
}

/**
 * Render the full email.
 * @param {Object} issue  { subject, section1, section2, section3 }
 * @param {Object} ctx    { date, sources, resourceChosen, unsubscribeUrl, webUrl }
 */
function renderEmailHtml(issue, ctx = {}) {
  const dateStr = ctx.date
    ? new Date(ctx.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  const bodyP = `margin:0 0 16px;font-size:17px;line-height:1.65;color:${INK};font-family:Georgia,'Times New Roman',serif;`;
  const label = `font-family:'DM Mono','Space Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${GOLD};margin:0 0 10px;`;

  const resource = ctx.resourceChosen;
  const resourceLine = resource
    ? `<p style="${label}">Go to the source</p>
       <p style="margin:0 0 8px;font-size:15px;line-height:1.5;font-family:Georgia,serif;color:${INK};">
         <a href="${resource.url}" style="color:${INK};text-decoration:underline;">${escapeHtml(resource.person)} — ${escapeHtml(
        resource.title
      )}</a>
       </p>`
    : '';

  return `<!-- Earl newsletter -->
<div style="background:${CREAM};margin:0;padding:0;">
  <div style="max-width:600px;margin:0 auto;padding:40px 28px;background:${CREAM};">

    <!-- header -->
    <div style="border-bottom:1px solid ${LINE};padding-bottom:18px;margin-bottom:28px;">
      <span style="font-family:'Playfair Display',Georgia,serif;font-size:30px;font-weight:700;color:${INK};letter-spacing:0.02em;">Earl</span>
      <span style="float:right;font-family:'DM Mono','Space Mono',monospace;font-size:12px;color:${MUTE};padding-top:14px;">${dateStr}</span>
    </div>

    <!-- section 1 -->
    <p style="${label}">One thing from the world this week</p>
    ${paragraphs(issue.section1, bodyP)}

    <div style="height:1px;background:${LINE};margin:30px 0;"></div>

    <!-- section 2 -->
    <p style="${label}">One thing someone else learned the hard way</p>
    ${paragraphs(issue.section2, bodyP)}
    ${resourceLine}

    <div style="height:1px;background:${LINE};margin:30px 0;"></div>

    <!-- section 3 — the question, set apart -->
    <div style="background:#efe7d6;border-left:3px solid ${GOLD};padding:20px 22px;margin:8px 0 30px;">
      <p style="margin:0;font-size:20px;line-height:1.5;font-style:italic;font-family:'Playfair Display',Georgia,serif;color:${INK};">${escapeHtml(
        issue.section3
      )}</p>
    </div>

    <!-- sources -->
    <div style="border-top:1px solid ${LINE};padding-top:18px;margin-top:24px;">
      <p style="${label}">Sources</p>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.7;color:${MUTE};font-family:'DM Mono','Space Mono',monospace;">
        ${sourceLinks(ctx.sources)}
      </p>
    </div>

    <!-- footer -->
    <div style="border-top:1px solid ${LINE};padding-top:18px;margin-top:18px;text-align:center;">
      <p style="margin:0 0 6px;font-size:12px;color:${MUTE};font-family:Georgia,serif;">
        ${ctx.webUrl ? `<a href="${ctx.webUrl}" style="color:${MUTE};">Read in your browser</a> &nbsp;·&nbsp; ` : ''}
        Earl, for people keeping a business alive.
      </p>
      ${
        ctx.unsubscribeUrl
          ? `<p style="margin:0;font-size:11px;color:${LINE};"><a href="${ctx.unsubscribeUrl}" style="color:${MUTE};">Unsubscribe</a></p>`
          : ''
      }
    </div>

  </div>
</div>`;
}

/** Plain-text fallback for email clients that want it. */
function renderText(issue, ctx = {}) {
  const lines = [];
  lines.push(issue.subject || 'Earl');
  lines.push('');
  lines.push('ONE THING FROM THE WORLD THIS WEEK');
  lines.push(issue.section1 || '');
  lines.push('');
  lines.push('ONE THING SOMEONE ELSE LEARNED THE HARD WAY');
  lines.push(issue.section2 || '');
  if (ctx.resourceChosen) lines.push(`Source: ${ctx.resourceChosen.person} — ${ctx.resourceChosen.title} (${ctx.resourceChosen.url})`);
  lines.push('');
  lines.push('ONE QUESTION TO CARRY INTO THE WEEK');
  lines.push(issue.section3 || '');
  lines.push('');
  if (ctx.sources && ctx.sources.length) {
    lines.push('Sources: ' + ctx.sources.map((s) => s.url).filter(Boolean).join(' | '));
  }
  if (ctx.unsubscribeUrl) lines.push(`Unsubscribe: ${ctx.unsubscribeUrl}`);
  return lines.join('\n');
}

module.exports = { renderEmailHtml, renderText };
