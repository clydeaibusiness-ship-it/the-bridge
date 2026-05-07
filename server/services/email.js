const { Resend } = require('resend');

let resend = null;

function getClient() {
  if (!resend && process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM = 'The Bridge <captain@captainsbridge.io>';

async function sendWelcomeEmail(email, shipName) {
  const client = getClient();
  if (!client) return;

  await client.emails.send({
    from: FROM,
    to: email,
    subject: 'Your ship has been saved, Captain.',
    html: `
      <div style="font-family: 'Space Grotesk', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #0a0a0f;">
        <p style="font-size: 16px; line-height: 1.6;">
          ${shipName} has been docked safely. Your game state is saved — pick up where you left off anytime.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          Every run teaches you something about your real business. The patterns the simulator reveals are the same patterns that play out in real markets.
        </p>
        <div style="margin: 32px 0;">
          <a href="https://captainsbridge.io/game" style="display: inline-block; background: #0a0a0f; color: #f5f0e8; padding: 14px 32px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 2px;">Resume Your Run</a>
        </div>
        <p style="font-size: 13px; color: #8a8a96;">
          Want deeper strategic insight? <a href="https://captainsbridge.io/#pricing" style="color: #0a0a0f;">Become an Ensign member</a> for your full Navigation Chart, the Commander advisor, and more.
        </p>
      </div>
    `
  });
}

async function sendDebriefEmail(email, shipName, debriefText) {
  const client = getClient();
  if (!client) return;

  // Convert markdown-ish debrief to simple HTML
  const htmlContent = debriefText
    .replace(/## (.*)/g, '<h2 style="font-size:18px;margin-top:24px;margin-bottom:8px;">$1</h2>')
    .replace(/\n\n/g, '</p><p style="font-size:16px;line-height:1.6;">')
    .replace(/\n/g, '<br>');

  await client.emails.send({
    from: FROM,
    to: email,
    subject: `${shipName} — Mission Debrief`,
    html: `
      <div style="font-family: 'Space Grotesk', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #0a0a0f;">
        <p style="font-size: 16px; line-height: 1.6;">${htmlContent}</p>
        <hr style="border: none; border-top: 1px solid #d4cfc5; margin: 32px 0;">
        <div style="text-align: center;">
          <a href="https://captainsbridge.io/#pricing" style="display: inline-block; background: #0a0a0f; color: #f5f0e8; padding: 14px 32px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 2px;">Become a Member</a>
        </div>
      </div>
    `
  });
}

async function sendSubscriptionConfirmation(email) {
  const client = getClient();
  if (!client) return;

  await client.emails.send({
    from: FROM,
    to: email,
    subject: 'Welcome to The Bridge, Ensign.',
    html: `
      <div style="font-family: 'Space Grotesk', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #0a0a0f;">
        <p style="font-size: 16px; line-height: 1.6;">
          Your Ensign membership is active. You now have full access to The Bridge.
        </p>
        <p style="font-size: 16px; line-height: 1.6;">
          <strong>Start here:</strong> Head to your dashboard and complete the full Navigation Chart intake. That's your strategic foundation — everything else builds on it.
        </p>
        <div style="margin: 32px 0;">
          <a href="https://captainsbridge.io/dashboard" style="display: inline-block; background: #0a0a0f; color: #f5f0e8; padding: 14px 32px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 2px;">Go to Dashboard</a>
        </div>
      </div>
    `
  });
}

async function sendWeeklyDigest(emailList, digestContent) {
  const client = getClient();
  if (!client) return;

  for (const email of emailList) {
    try {
      await client.emails.send({
        from: FROM,
        to: email,
        subject: 'This week on The Bridge',
        html: `
          <div style="font-family: 'Space Grotesk', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px; color: #0a0a0f;">
            <p style="font-size: 16px; line-height: 1.6;">${digestContent}</p>
            <hr style="border: none; border-top: 1px solid #d4cfc5; margin: 32px 0;">
            <div style="text-align: center;">
              <a href="https://captainsbridge.io/game" style="display: inline-block; background: #0a0a0f; color: #f5f0e8; padding: 14px 32px; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; border-radius: 2px;">Launch the Simulator</a>
            </div>
          </div>
        `
      });
    } catch (e) {
      console.error(`Failed to send digest to ${email}:`, e.message);
    }
  }
}

module.exports = {
  sendWelcomeEmail,
  sendDebriefEmail,
  sendSubscriptionConfirmation,
  sendWeeklyDigest
};
