// Google and Apple sign-in from inside an app's iOS shell. The server half and
// the reasons are in server/native.js; this is the half that runs in the webview.
//
// Capacitor injects its bridge (`window.Capacitor`) into the live site when the
// shell loads it. `Capacitor.Plugins.Browser` only exists once a page bundles
// @capacitor/core and registers the plugin, so this calls the bridge directly
// (nativePromise, addListener: what @capacitor/core calls underneath) and the
// web build carries no Capacitor code. The shell itself must include
// @capacitor/browser and @capacitor/app; PluginHeaders lists what it has.

export function isNativeShell() {
  return typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
}

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Sign in with a provider through the in-app browser, then return to the app
 * signed in. Resolves once the webview has its session and is navigating to
 * `callbackUrl`; rejects if the person closes the browser or the hand-over fails.
 */
export async function nativeSignIn(provider, { callbackUrl = '/' } = {}) {
  const cap = window.Capacitor;
  const has = (name) => (cap?.PluginHeaders || []).some((h) => h.name === name);
  if (!has('Browser') || !has('App')) {
    throw new Error('[aspiro-auth] the iOS shell needs @capacitor/browser and @capacitor/app');
  }
  const closeBrowser = () => cap.nativePromise('Browser', 'close', {}).catch(() => {});

  // The secret stays here; only its hash goes to the browser (server/native.js).
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));

  return new Promise((resolve, reject) => {
    let settled = false;
    let returning = false; // the app was opened from the browser: not a cancel
    const handles = [];
    const done = (error) => {
      if (settled) return;
      settled = true;
      handles.forEach((h) => h.remove());
      if (error) reject(error);
      else resolve();
    };

    handles.push(
      cap.addListener('App', 'appUrlOpen', async ({ url }) => {
        if (!url || !url.includes('://auth-callback')) return;
        returning = true;
        closeBrowser();
        const params = new URL(url.replace(/^[^:]+:\/\//, 'https://x/')).searchParams;
        const code = params.get('code');
        if (!code) return done(new Error(params.get('error') || 'sign-in failed'));
        try {
          const res = await fetch('/api/auth/native/redeem', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, verifier }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'sign-in failed');
          done();
          window.location.replace(callbackUrl);
        } catch (error) {
          done(error);
        }
      }),
      // The person closed the browser with Done before finishing.
      cap.addListener('Browser', 'browserFinished', () => {
        if (!returning) done(new Error('cancelled'));
      }),
    );

    const url = `${window.location.origin}/api/auth/native/start?provider=${encodeURIComponent(provider)}&challenge=${challenge}`;
    cap.nativePromise('Browser', 'open', { url }).catch(done);
  });
}
