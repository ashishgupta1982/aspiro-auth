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
  // Neutral slate for an app that gives no colour: the email button
  // then read as plain, not as some other app's brand.
  colour: '#111827',
  fallbackUrl: '',
  // Optional one-sentence nudge appended to the VERIFICATION email only, saying
  // what the user gets to do next in this particular app. It exists because the
  // extraction from ChessMaster carried its "link your chess.com username"
  // sentence into the shared file, which CookBook would then have sent to its
  // own users. App-specific copy has to be app-supplied or it leaks.
  verifyNote: '',
  // The branded layout (the default; a letter since 0.9.5): the icon and name
  // at the top, a title, the message and one button in the brand colour.
  // `logo` is an absolute icon URL; left out, the icon is found on the app's
  // own site (findLogo), and it is attached to the email so it shows without
  // "Load content". `colour2` was the band's gradient (0.9.3-0.9.4) and is
  // accepted but unused now. `plainEmail: true` keeps the layout from before 0.9.3.
  logo: '',
  colour2: '',
  plainEmail: false,
};

// The app's icon, for the top of the email, when the app names none: the first of
// the usual places on its own site that answers. A mail client cannot fall
// back from a broken image, so this is checked before sending, once per
// process, and a miss leaves just the name.
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

// The branded layout (0.9.5): a letter, not a card. The icon and name at the
// top, a short title, the message, one button sized to its words, then the
// long link and the footer in small grey under a thin line. No band and no
// box: on a phone the old card read as a web page squeezed into Mail (Ash,
// 2026-11-08). Tables and inline styles only, because that is what mail
// clients render reliably. `logo` is the image src: `cid:` when the icon is
// attached to the email, a URL when it is not (see safeSend).
function brandedLayout({ heading, greeting, body, ctaLabel, ctaUrl, footnote, logo }) {
  const c = BRAND.colour;
  const host = hostOf(BRAND.fallbackUrl);
  const font = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
  return `
  <div style="font-family: ${font}; max-width: 480px; margin: 0 auto; padding: 24px 20px; color: #1a1d23; background: #ffffff;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      ${logo ? `<td style="padding-right: 10px; vertical-align: middle;"><img src="${logo}" width="36" height="36" alt="" style="display: block; width: 36px; height: 36px; border-radius: 9px;"></td>` : ''}
      <td style="vertical-align: middle; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; color: #1a1d23;">${BRAND.name}</td>
    </tr></table>
    ${heading ? `<h1 style="margin: 26px 0 0; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em; color: #1a1d23;">${heading}</h1>` : ''}
    <p style="margin: ${heading ? '14px' : '24px'} 0 0; font-size: 16px; line-height: 25px; color: #1a1d23;">${greeting}</p>
    <p style="margin: 10px 0 0; font-size: 16px; line-height: 25px; color: #374151;">${body}</p>
    ${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top: 22px;"><tr><td bgcolor="${c}" style="border-radius: 10px;">
      <a href="${ctaUrl}" style="display: inline-block; padding: 13px 24px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 10px;">${ctaLabel}</a>
    </td></tr></table>` : ''}
    ${footnote ? `<p style="margin: 22px 0 0; font-size: 14px; line-height: 21px; color: #6b7280;">${footnote}</p>` : ''}
    <div style="margin-top: 26px; padding-top: 18px; border-top: 1px solid #eeeeee;">
      ${ctaUrl ? `<p style="margin: 0; font-size: 12px; line-height: 18px; color: #9ca3af;">Button not working? Copy this link into your browser:<br><span style="color: #6b7280; word-break: break-all;">${ctaUrl}</span></p>` : ''}
      ${host ? `<p style="margin: ${ctaUrl ? '14px' : '0'} 0 0; font-size: 12px; line-height: 18px; color: #9ca3af;">${BRAND.name} · ${host}</p>` : ''}
    </div>
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

async function deliver({ to, subject, html, attachments }) {
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
      ...(attachments ? { attachments } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 200)}`);
  }

  return { sent: true };
}

// The icon goes INSIDE the email, as an inline attachment the HTML points at
// with `cid:`, rather than as a link to the app's site. Mail clients hold back
// linked images until the reader taps "Load content" (Apple Mail showed a "?"
// in its place, 2026-11-08); an attached one shows at once. Resend fetches the
// file from `path`. If Resend refuses the attachment, the email goes again
// with the linked icon, so a problem with the image never stops a sign-up.
const LOGO_CID = 'app-icon';

function logoAttachment(url) {
  const ext = (url.split('?')[0].match(/\.(png|jpe?g|gif|webp)$/i) || [, 'png'])[1].toLowerCase();
  return { path: url, filename: `icon.${ext}`, content_id: LOGO_CID };
}

async function safeSend({ to, subject, parts, logLine }) {
  try {
    // Surface the link ONLY when there is no provider (local dev), so the flow can
    // still be completed by pasting it. Never in production: a logged reset link
    // is a working account takeover for anyone who can read the host's logs, and
    // it undoes storing the token hashed. Found in the 2026-11-06 sweep.
    if (logLine && !process.env.RESEND_API_KEY) console.log(logLine);
    const logo = BRAND.plainEmail ? '' : await findLogo();
    if (logo) {
      try {
        return await deliver({
          to,
          subject,
          html: layout({ ...parts, logo: `cid:${LOGO_CID}` }),
          attachments: [logoAttachment(logo)],
        });
      } catch (error) {
        console.warn('[email] Sending with the attached icon failed, sending with a linked one:', error?.message || error);
      }
    }
    return await deliver({ to, subject, html: layout({ ...parts, logo }) });
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
    parts: {
      heading: 'Verify your email',
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: verificationBody(),
      ctaLabel: 'Verify my email',
      ctaUrl: verifyUrl,
      footnote: "This link expires in 24 hours. If you didn't create an account, you can ignore this email.",
    },
  });
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  return safeSend({
    to,
    subject: `Reset your ${BRAND.name} password`,
    logLine: `[email] Password reset link for ${to}: ${resetUrl}`,
    parts: {
      heading: 'Reset your password',
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: 'We received a request to set a new password on your account. Click below to choose one.',
      ctaLabel: 'Choose a new password',
      ctaUrl: resetUrl,
      footnote: "This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email — your password won't change.",
    },
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
    parts: {
      heading: 'You already have an account',
      greeting: name ? `Hi ${name},` : 'Hi,',
      body: hasPassword
        ? 'Someone just tried to create an account with this email address, but you already have one. If that was you, sign in instead — or use "Forgot password" if you can\'t remember it.'
        : 'Someone just tried to create an account with this email address. You already have an account that signs in with Google or Apple. If that was you, sign in with the button you used originally — or use "Forgot password" to add a password to your account.',
      ctaLabel: 'Go to sign in',
      ctaUrl: signInUrl,
      footnote: "If this wasn't you, no action is needed — nothing about your account has changed.",
    },
  });
}
