/**
 * archive.js — server-rendered public archive at /newsletter.
 *
 * Fully public, no signup wall. Each issue appears 7 days after it emailed.
 * Pages are real HTML (good for Google and AI search): semantic markup, unique
 * title and description, clean headings, Article JSON-LD, and a subscribe CTA
 * so a reader can get it fresh instead of a week late.
 */

const BASE = process.env.PUBLIC_BASE_URL || 'https://captainsbridge.io';

const CREAM = '#f5f0e8', INK = '#1a1512', GOLD = '#c8a96e', GOLD_D = '#a8884c', MUTE = '#7a7570', LINE = '#e0d8c8';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

function paragraphs(text) {
  return String(text || '')
    .split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

const STYLE = `
  :root{--cream:${CREAM};--ink:${INK};--gold:${GOLD};--gold-d:${GOLD_D};--mute:${MUTE};--line:${LINE};}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--cream);color:var(--ink);font-family:Georgia,'Times New Roman',serif;line-height:1.6;}
  .wrap{max-width:680px;margin:0 auto;padding:34px 22px 60px;}
  .top{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:26px;}
  .brand{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:26px;text-decoration:none;color:var(--ink);}
  .kick{font-family:'DM Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--mute);}
  .top .sp{flex:1;}
  a.nav{font-family:'DM Mono',monospace;font-size:12px;color:var(--gold-d);text-decoration:none;}
  h1{font-family:'Playfair Display',Georgia,serif;font-weight:700;line-height:1.2;font-size:30px;margin:6px 0 6px;}
  time,.dateline{font-family:'DM Mono',monospace;font-size:12px;color:var(--mute);}
  .lab{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold-d);margin:26px 0 6px;}
  p{font-size:17px;margin:0 0 14px;}
  .q{background:#efe7d6;border-left:3px solid var(--gold);padding:18px 20px;margin:18px 0;font-family:'Playfair Display',serif;font-style:italic;font-size:20px;}
  .reslink{font-size:15px;margin-top:8px;}
  .sources{border-top:1px dashed var(--line);margin-top:28px;padding-top:14px;font-family:'DM Mono',monospace;font-size:12px;color:var(--mute);}
  .sources a{color:var(--mute);}
  .cta{background:#fffdf8;border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin:30px 0;}
  .cta h3{font-family:'Playfair Display',serif;margin:0 0 6px;font-size:18px;}
  .cta input{font-family:Georgia,serif;font-size:15px;padding:9px 11px;border:1px solid var(--line);border-radius:4px;width:62%;}
  .cta button{font-family:'DM Mono',monospace;font-size:13px;background:var(--ink);color:var(--cream);border:none;padding:10px 16px;border-radius:4px;cursor:pointer;margin-left:6px;}
  .issue-row{display:block;border-bottom:1px solid var(--line);padding:16px 0;text-decoration:none;color:var(--ink);}
  .issue-row:hover h2{color:var(--gold-d);}
  .issue-row h2{font-family:'Playfair Display',serif;font-size:21px;font-weight:600;margin:4px 0 0;}
  .empty{color:var(--mute);font-family:'DM Mono',monospace;font-size:14px;padding:30px 0;}
  .foot{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;font-family:'DM Mono',monospace;font-size:11px;color:var(--mute);}
`;

function shell({ title, desc, canonical, head = '', body }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${attr(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}"><meta property="og:url" content="${attr(canonical)}">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style>${head}
</head><body><div class="wrap">
<div class="top"><a class="brand" href="/newsletter">Earl</a><span class="kick">Newsletter</span><span class="sp"></span><a class="nav" href="/">captainsbridge.io →</a></div>
${body}
<div class="foot">Earl, for people keeping a business alive. Past issues are free; the newsletter lands a week earlier in your inbox.</div>
</div></body></html>`;
}

const SUBSCRIBE_CTA = `
<div class="cta">
  <h3>Get it a week early</h3>
  <p style="font-size:14px;color:${MUTE};margin:0 0 10px">These pages trail the email by seven days. Subscribe and Earl lands in your inbox fresh, free.</p>
  <form id="sub"><input id="em" type="email" placeholder="you@business.com" required><button>Subscribe</button></form>
  <div id="submsg" style="font-family:'DM Mono',monospace;font-size:12px;color:${GOLD_D};margin-top:8px"></div>
</div>
<script>
  document.getElementById('sub').addEventListener('submit', async function(e){
    e.preventDefault(); var em=document.getElementById('em').value, m=document.getElementById('submsg');
    m.textContent='…';
    try{ var r=await fetch('/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em})});
      m.textContent = r.ok ? "You're on the list." : 'Try a valid email.'; if(r.ok) document.getElementById('sub').reset();
    }catch(_){ m.textContent='Something went wrong, try again.'; }
  });
</script>`;

/** The archive index: a running, dated list of issues. */
function renderArchiveIndex(issues) {
  const rows = issues.length
    ? issues.map((i) => `<a class="issue-row" href="/newsletter/${attr(i.slug)}"><time>${fmtDate(i.sent_at)}</time><h2>${esc(i.subject || (i.story && i.story.headline) || 'Issue')}</h2></a>`).join('\n')
    : `<div class="empty">The first issues are publishing soon. Subscribe above to get them fresh.</div>`;
  return shell({
    title: "Earl's Newsletter — survival notes for small business owners",
    desc: 'Plain, non-partisan reads for small business owners: one thing from the world this week, one principle worth keeping, one question to carry. Free archive.',
    canonical: `${BASE}/newsletter`,
    body: `<h1>Survival notes, three times a week.</h1>
<p style="color:${MUTE};font-size:16px">One thing from the world this week. One thing someone learned the hard way. One question to carry into the week.</p>
${SUBSCRIBE_CTA}
<div class="lab">All issues</div>
${rows}`,
  });
}

/** A single issue page. */
function renderArchivePost(issue) {
  const desc = String(issue.section1 || '').replace(/\s+/g, ' ').slice(0, 155);
  const canonical = `${BASE}/newsletter/${issue.slug}`;
  const res = issue.resource;
  const sources = Array.isArray(issue.sources) ? issue.sources : [];
  const seen = new Set();
  const sourceLinks = sources
    .filter((s) => s.domain && !seen.has(s.domain) && seen.add(s.domain))
    .map((s) => `<a href="${attr(s.url)}" target="_blank" rel="noopener">${esc(s.domain)}</a>${s.lean ? ` (${esc(s.lean)})` : ''}`)
    .join(' &nbsp;·&nbsp; ');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: issue.subject || (issue.story && issue.story.headline) || 'Earl',
    datePublished: issue.publish_at, dateModified: issue.publish_at,
    author: { '@type': 'Person', name: 'Earl' },
    publisher: { '@type': 'Organization', name: "Captain's Bridge" },
    mainEntityOfPage: canonical,
  };

  return shell({
    title: `${issue.subject || 'Issue'} — Earl`,
    desc,
    canonical,
    head: `\n<script type="application/ld+json">${JSON.stringify(jsonld)}</script>`,
    body: `<article>
<time>${fmtDate(issue.sent_at)}</time>
<h1>${esc(issue.subject || '')}</h1>
<div class="lab">One thing from the world this week</div>
${paragraphs(issue.section1)}
<div class="lab">One thing someone else learned the hard way</div>
${paragraphs(issue.section2)}
${res ? `<p class="reslink">Learn from someone who's done it: <a href="${attr(res.url)}" target="_blank" rel="noopener">${esc(res.person)} — ${esc(res.title)}</a></p>` : ''}
<div class="lab">One question to carry into the week</div>
<div class="q">${esc(issue.section3 || '')}</div>
${sourceLinks ? `<div class="sources"><strong>Sources:</strong> ${sourceLinks}</div>` : ''}
</article>
${SUBSCRIBE_CTA}`,
  });
}

module.exports = { renderArchiveIndex, renderArchivePost };
