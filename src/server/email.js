// Single integration point for outbound transactional email.
//
// Delivery goes through Resend's REST API with plain fetch — deliberately no SDK
// dependency, so copying this file into another app costs nothing but an API key.
//
// If RESEND_API_KEY is unset (local dev, or before the domain is verified), every
// send becomes a no-op that logs the link to the server console, so the whole
// flow is still completable by pasting the URL into a browser. Sending never
// throws into callers: a transient email failure must not break a sign-up.
//
// Brand comes from createAuth({ brand }) — see configureBrand below.

// The one place to change when reusing this file. `colour` is the `accent`
// token from tailwind.config.mjs — email clients can't read a Tailwind class,
// so this is the documented exception to the "colour lives in two places" rule.
// Brand is injected by createAuth() rather than edited per copy — that was the
// single thing every app changed in this file. Module-level state is fine here:
// each app is its own Node process and calls createAuth() once at import time.
let BRAND = {
  name: 'App',
  colour: '#111827',
  fallbackUrl: '',
};

export function configureBrand(next) {
  BRAND = { ...BRAND, ...next };
}

export function appBaseUrl() {
  return process.env.NEXTAUTH_URL || BRAND.fallbackUrl;
}

// Sending happens on a SUBDOMAIN (send.aspiro-consulting.co.uk), not the root.
// The root domain's SPF is `v=spf1 include:secureserver.net -all` and its MX
// points at the 123-reg/GoDaddy mailbox; a subdomain sender gets its own SPF and
// DKIM, so none of that is touched and existing mail cannot break. DMARC on the
// root uses relaxed alignment, so the subdomain still aligns.
function fromAddress() {
  return process.env.EMAIL_FROM || `${BRAND.name} <noreply@send.aspiro-consulting.co.uk>`;
}

// Replies go to the real monitored mailbox, not the unattended sending address.
function replyToAddress() {
  return process.env.EMAIL_REPLY_TO || 'support@aspiro-consulting.co.uk';
}

function layout({ heading, greeting, body, ctaLabel, ctaUrl, footnote }) {
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
    <h1 style="font-size: 20px; color: ${BRAND.colour}; margin: 0 0 16px;">${BRAND.name}</h1>
    ${heading ? `<h2 style="font-size: 17px; margin: 0 0 12px;">${heading}</h2>` : ''}
    <p style="font-size: 15px; line-height: 22px;">${greeting}</p>
    <p style="font-size: 15px; line-height: 22px;">${body}</p>
    ${ctaUrl ? `<p style="margin: 24px 0;">
      <a href="${ctaUrl}" style="display: inline-block; background: ${BRAND.colour}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 12px 20px; border-radius: 8px;">${ctaLabel}</a>
    </p>` : ''}
    ${footnote ? `<p style="font-size: 13px; line-height: 20px; color: #6b7280;">${footnote}</p>` : ''}
    ${ctaUrl ? `<p style="font-size: 12px; line-height: 18px; color: #9ca3af; word-break: break-all;">Or paste this link into your browser:<br>${ctaUrl}</p>` : ''}
  </div>`;
}

async function deliver({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn(`[email] No RESEND_API_KEY — skipping send to ${to}. Subject: "${subject}"`);
    return { skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      reply_to: replyToAddress(),
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true };
}

async function safeSend({ to, subject, html, logLine }) {
  try {
    // Always surface the link in logs so a machine with no provider configured
    // can still complete the flow.
    if (logLine) console.log(logLine);
    return await deliver({ to, subject, html });
  } catch (error) {
    console.error('[email] Send failed:', error?.message || error);
    return { error: error?.message || 'send failed' };
  }
}

export async function sendVerificationEmail({ to, name, verifyUrl }) {
  return safeSend({
    to,
    subject: `Verify your ${BRAND.name} email`,
    logLine: `[email] Verification link for ${to}: ${verifyUrl}`,
    html: layout({
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: 'Please confirm your email address to finish setting up your account. Then link your chess.com username and we’ll start analysing your games.',
      ctaLabel: 'Verify my email',
      ctaUrl: verifyUrl,
      footnote: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    }),
  });
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  return safeSend({
    to,
    subject: `Reset your ${BRAND.name} password`,
    logLine: `[email] Password reset link for ${to}: ${resetUrl}`,
    html: layout({
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: 'We received a request to set a new password on your account. Click below to choose one.',
      ctaLabel: 'Choose a new password',
      ctaUrl: resetUrl,
      footnote: "This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.",
    }),
  });
}

/**
 * Sent when someone tries to register an email that already has an account.
 * Registration responds with the same generic message either way, so this email
 * is what tells the real owner what happened — without leaking to the requester
 * whether the address exists.
 */
export async function sendAccountExistsEmail({ to, name, hasPassword }) {
  const signInUrl = `${appBaseUrl()}/signin`;
  return safeSend({
    to,
    subject: `You already have a ${BRAND.name} account`,
    logLine: `[email] Account-exists notice for ${to}`,
    html: layout({
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: hasPassword
        ? 'Someone just tried to create an account with this email address, but you already have one. If that was you, sign in instead — or use "Forgot password" if you can\'t remember it.'
        : 'Someone just tried to create an account with this email address. You already have an account that signs in with Google or Apple. If that was you, sign in with the button you used originally — or use "Forgot password" to add a password to your account.',
      ctaLabel: 'Go to sign in',
      ctaUrl: signInUrl,
      footnote: "If this wasn't you, no action is needed — nothing about your account has changed.",
    }),
  });
}
