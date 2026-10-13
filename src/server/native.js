import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { serialize } from 'cookie';
import { MongoDBAdapter } from '@next-auth/mongodb-adapter';
import { createDbSession, sessionCookieName } from './session.js';

// Google and Apple sign-in inside an app's iOS shell.
//
// The shell is a WKWebView on the live site. Google refuses to sign anyone in
// inside an embedded webview, so the provider flow runs in the system's in-app
// browser instead (SFSafariViewController, via @capacitor/browser). That browser
// keeps its own cookies, which the webview cannot see: the NextAuth session the
// provider flow creates lands in the browser, not in the app. These three routes
// carry it across:
//
//   start   (in the browser)  begins the ordinary NextAuth sign-in, with
//                             `finish` as its callbackUrl
//   finish  (in the browser)  swaps the browser's session for a one-time code
//                             and opens the app at <scheme>://auth-callback
//   redeem  (in the webview)  exchanges the code for a database session of the
//                             webview's own
//
// The code travels through a custom URL scheme, which any app can register, so
// the code alone must not be enough. Before opening the browser the webview
// makes a secret (the verifier) and sends only its SHA-256 (the challenge);
// redeem requires the verifier, which never leaves the webview. This is PKCE's
// shape, applied to the hand-over.

const COLLECTION = 'nativehandoffs';
const CODE_TTL_MS = 2 * 60 * 1000;
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/; // a SHA-256 or 32 random bytes, base64url
const SCHEME = /^[a-z][a-z0-9+.-]*$/;

const sha256 = (value) => createHash('sha256').update(value).digest('base64url');

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function handoffs(clientPromise) {
  const client = await clientPromise;
  const col = client.db().collection(COLLECTION);
  // Mongo reaps expired codes itself. Creating an existing index is a no-op.
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
  return col;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** GET ?provider=google|apple&challenge=… — runs in the in-app browser. */
export function createNativeStartHandler({ brandName }) {
  return function handler(req, res) {
    const { provider, challenge } = req.query || {};
    if (!['google', 'apple'].includes(provider) || !B64URL_43.test(String(challenge || ''))) {
      return res.status(400).send('Bad request');
    }

    // NextAuth starts a provider sign-in on a POST carrying its CSRF token. This
    // page makes the same two requests next-auth/react's signIn() makes (json:
    // true, so NextAuth answers with the provider's URL) and then navigates.
    // Not a submitted form: a CSP of `form-action 'self'` covers a form's
    // redirect to the provider too, and would block it. provider and challenge
    // are validated above, so both are safe inside the script.
    const callbackUrl = `/api/auth/native/finish?challenge=${challenge}`;
    const name = escapeHtml(brandName);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:17px -apple-system,BlinkMacSystemFont,sans-serif;color:#4b5563;background:#fff}</style>
</head><body>
<p>Opening sign-in&hellip;</p>
<script>
fetch('/api/auth/csrf', { credentials: 'same-origin' })
  .then(function (r) { return r.json(); })
  .then(function (d) {
    return fetch('/api/auth/signin/${provider}', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken: d.csrfToken, callbackUrl: '${callbackUrl}', json: 'true' }),
    });
  })
  .then(function (r) { return r.json(); })
  .then(function (d) { if (!d.url) throw new Error(); window.location.href = d.url; })
  .catch(function () { document.body.innerHTML = '<p>Could not start sign-in. Close this and try again.</p>'; });
</script>
</body></html>`);
  };
}

/** GET ?challenge=… — NextAuth's callbackUrl, so it runs in the in-app browser. */
export function createNativeFinishHandler({ clientPromise, scheme }) {
  return async function handler(req, res) {
    const back = (query) => {
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, `${scheme}://auth-callback?${new URLSearchParams(query)}`);
    };

    const challenge = String(req.query?.challenge || '');
    if (!B64URL_43.test(challenge)) return back({ error: 'bad_request' });

    const token = req.cookies?.[sessionCookieName()];
    if (!token) return back({ error: 'no_session' });

    try {
      const adapter = MongoDBAdapter(clientPromise);
      const found = await adapter.getSessionAndUser(token);
      if (!found?.user?.id) return back({ error: 'no_session' });

      // The browser's session was only ever a vehicle. End it, so the one
      // session that exists is the app's, and signing out in the app means it.
      await adapter.deleteSession(token).catch(() => {});
      res.setHeader('Set-Cookie', serialize(sessionCookieName(), '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      }));

      const code = randomBytes(32).toString('base64url');
      const col = await handoffs(clientPromise);
      await col.insertOne({
        _id: sha256(code), // only the hash is stored
        userId: String(found.user.id),
        challenge,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      });
      return back({ code });
    } catch (error) {
      console.error('[aspiro-auth] native finish failed:', error?.message || error);
      return back({ error: 'server' });
    }
  };
}

/** POST {code, verifier} — runs in the webview; sets the webview's session cookie. */
export function createNativeRedeemHandler({ clientPromise, checkRate, getClientIP }) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!checkRate(getClientIP(req), 'AUTH_API').allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    const { code, verifier } = req.body || {};
    if (!B64URL_43.test(String(code || '')) || !B64URL_43.test(String(verifier || ''))) {
      return res.status(400).json({ error: 'Sign-in could not be completed. Please try again.' });
    }

    try {
      const col = await handoffs(clientPromise);
      // Delete as it is read: a code works once, whatever happens next.
      const result = await col.findOneAndDelete({ _id: sha256(code) });
      const handoff = result?.value !== undefined ? result.value : result; // driver 5 vs 6 shape
      if (!handoff || handoff.expiresAt < new Date() || !sameString(sha256(verifier), handoff.challenge)) {
        return res.status(400).json({ error: 'Sign-in could not be completed. Please try again.' });
      }

      await createDbSession({ clientPromise, userId: handoff.userId, res });
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error('[aspiro-auth] native redeem failed:', error?.message || error);
      return res.status(500).json({ error: 'Sign-in could not be completed. Please try again.' });
    }
  };
}

export function assertScheme(scheme) {
  if (!SCHEME.test(String(scheme || ''))) {
    throw new Error('[aspiro-auth] config.native.scheme must be a URL scheme, e.g. the bundle id');
  }
}
