/**
 * send.js — delivers a finished issue to the list via Resend.
 *
 * Each recipient gets their own unsubscribe link (their token) and a
 * List-Unsubscribe header for one-click unsubscribe in Gmail/Apple Mail, which
 * also helps deliverability. Every message is tagged with the issue id so the
 * Resend webhook can attribute opens and clicks back to the issue.
 */

const { Resend } = require('resend');
const { renderEmailHtml, renderText } = require('./render');

let resend = null;
function client() {
  if (!resend && process.env.RESEND_API_KEY) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = 'Earl <earl@captainsbridge.io>';
const BASE = process.env.PUBLIC_BASE_URL || 'https://captainsbridge.io';

/**
 * @param {Object} args
 * @param {Object} args.issue          the persisted issue row (has id, slug, subject, sections, send_date)
 * @param {Array}  args.sources        story sources for the footer
 * @param {Object} args.resourceChosen the one resource link
 * @param {Array}  args.subscribers    [{ email, unsubscribe_token }]
 * @returns {Promise<{sent:number, failed:number}>}
 */
async function sendIssueToList({ issue, sources, resourceChosen, subscribers }) {
  const c = client();
  if (!c) return { sent: 0, failed: 0, error: 'RESEND_API_KEY not set' };
  if (!subscribers?.length) return { sent: 0, failed: 0 };

  const webUrl = issue.slug ? `${BASE}/newsletter/${issue.slug}` : null;
  let sent = 0;
  let failed = 0;

  // Resend batch.send accepts up to 100 messages per call.
  for (let i = 0; i < subscribers.length; i += 100) {
    const chunk = subscribers.slice(i, i + 100);
    const messages = chunk.map((sub) => {
      const unsub = `${BASE}/api/newsletter/unsubscribe?token=${sub.unsubscribe_token}`;
      const ctx = { date: issue.send_date, sources, resourceChosen, unsubscribeUrl: unsub, webUrl };
      return {
        from: FROM,
        to: sub.email,
        subject: issue.subject || 'Earl',
        html: renderEmailHtml(issue, ctx),
        text: renderText(issue, ctx),
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [{ name: 'issue_id', value: String(issue.id) }],
      };
    });
    try {
      await c.batch.send(messages);
      sent += messages.length;
    } catch (e) {
      failed += messages.length;
      console.error('[newsletter send] batch failed:', e.message);
    }
  }
  return { sent, failed };
}

module.exports = { sendIssueToList, FROM };
