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
  // Neutral slate for an app that gives no colour: the email band and button
  // then read as plain, not as some other app's brand.
  colour: '#111827',
  fallbackUrl: '',
  // Optional one-sentence nudge appended to the VERIFICATION email only, saying
  // what the user gets to do next in this particular app. It exists because the
  // extraction from ChessMaster carried its "link your chess.com username"
  // sentence into the shared file, which CookBook would then have sent to its
  // own users. App-specific copy has to be app-supplied or it leaks.
  verifyNote: '',
  // The branded layout (0.9.3, the default): a band in the brand colour with
  // the icon and name, a full-width button and the long link tucked into a
  // small strip at the foot. `logo` is an absolute icon URL; left out, the icon
  // is found on the app's own site (findLogo). `colour2` makes the band a
  // gradient where the mail client supports one; the solid colour shows where
  // it doesn't (Outlook). `plainEmail: true` keeps the layout from before 0.9.3.
  logo: '',
  colour2: '',
  plainEmail: false,
};

// The app's icon, for the email band, when the app names none: the first of
// the usual places on its own site that answers. A mail client cannot fall
// back from a broken image, so this is checked before sending, once per
// process, and a miss leaves the band with just the name.
const LOGO_GUESSES = ['/apple-touch-icon.png', '/icon-192.png'];
let logoLookup = null;

async function findLogo() {
  if (BRAND.logo) return BRAND.logo;
  if (!logoLookup) {
    logoLookup = (async () => {
      const base = (appBaseUrl() || '').replace(/\/$/, '');
      if (!/^https:\/\//.test(base)) return '';
      for (const path of LOGO_GUESSES) {
        try {
          const res = await fetch(base + path, { method: 'HEAD', signal: AbortSignal.timeout(2500) });
          if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) return base + path;
        } catch {
          // try the next one
        }
      }
      return '';
    })();
  }
  return logoLookup;
}

// Only the values an app actually gave: an app that sets no colour keeps the
// neutral slate above rather than an empty one.
export function configureBrand(next) {
  const given = Object.fromEntries(Object.entries(next || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  BRAND = { ...BRAND, ...given };
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

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// The branded layout: a band with the icon and name, the message in a card,
// and the link in a small strip below the button. Tables and inline styles
// only, because that is what mail clients render reliably.
function brandedLayout({ heading, greeting, body, ctaLabel, ctaUrl, footnote, logo }) {
  const c = BRAND.colour;
  const band = BRAND.colour2
    ? `background-color: ${c}; background-image: linear-gradient(135deg, ${c} 0%, ${BRAND.colour2} 100%);`
    : `background-color: ${c};`;
  const host = hostOf(BRAND.fallbackUrl);
  const font = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  return `
  <div style="font-family: ${font}; max-width: 480px; margin: 0 auto; padding: 16px 12px; color: #1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden;">
      <tr><td bgcolor="${c}" style="${band} padding: 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          ${logo ? `<td style="padding-right: 12px;"><img src="${logo}" width="40" height="40" alt="" style="display: block; width: 40px; height: 40px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.7);"></td>` : ''}
          <td style="font-size: 20px; font-weight: 700; color: #ffffff;">${BRAND.name}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding: 22px 20px 20px; background: #ffffff;">
        ${heading ? `<h2 style="font-size: 18px; margin: 0 0 12px;">${heading}</h2>` : ''}
        <p style="margin: 0; font-size: 17px; font-weight: 600;">${greeting}</p>
        <p style="margin: 10px 0 0; font-size: 16px; line-height: 24px; color: #374151;">${body}</p>
        ${ctaUrl ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px;"><tr><td bgcolor="${c}" style="border-radius: 12px; text-align: center;">
          <a href="${ctaUrl}" style="display: block; padding: 15px 0; color: #ffffff; text-decoration: none; font-size: 17px; font-weight: 700;">${ctaLabel}</a>
        </td></tr></table>` : ''}
        ${footnote ? `<p style="margin: 18px 0 0; font-size: 14px; line-height: 21px; color: #6b7280;">${footnote}</p>` : ''}
      </td></tr>
      ${ctaUrl ? `<tr><td style="padding: 14px 20px 16px; background: #f7f7f5; border-top: 1px solid #eeeeea;">
        <p style="margin: 0; font-size: 12px; line-height: 18px; color: #6b7280;">Button not working? Copy this link into your browser:</p>
        <p style="margin: 4px 0 0; font-size: 11px; line-height: 16px; color: #6b7280; word-break: break-all;">${ctaUrl}</p>
      </td></tr>` : ''}
    </table>
    ${host ? `<p style="margin: 16px 0 0; text-align: center; font-size: 12px; line-height: 18px; color: #9ca3af;">${BRAND.name} · ${host}</p>` : ''}
  </div>`;
}

function layout(parts) {
  if (!BRAND.plainEmail) return brandedLayout(parts);
  const { heading, greeting, body, ctaLabel, ctaUrl, footnote } = parts;
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
    // Surface the link ONLY when there is no provider (local dev), so the flow can
    // still be completed by pasting it. Never in production: a logged reset link
    // is a working account takeover for anyone who can read the host's logs, and
    // it undoes storing the token hashed. Found in the 2026-11-06 sweep.
    if (logLine && !process.env.RESEND_API_KEY) console.log(logLine);
    return await deliver({ to, subject, html });
  } catch (error) {
    console.error('[email] Send failed:', error?.message || error);
    return { error: error?.message || 'send failed' };
  }
}

// The generic sentence, plus whatever this app wants to say about what happens
// next. Keep the app's half in its BRAND, never here.
function verificationBody() {
  const base = 'Please confirm your email address to finish setting up your account.';
  return BRAND.verifyNote ? `${base} ${BRAND.verifyNote}` : base;
}

export async function sendVerificationEmail({ to, name, verifyUrl }) {
  return safeSend({
    to,
    subject: `Verify your ${BRAND.name} email`,
    logLine: `[email] Verification link for ${to}: ${verifyUrl}`,
    html: layout({
      logo: await findLogo(),
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: verificationBody(),
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
      logo: await findLogo(),
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
      logo: await findLogo(),
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
