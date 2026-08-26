import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import AuthPageShell, { authField, authPrimaryButton } from './AuthPageShell.jsx';

// Landing page for the emailed verification link.
//
// In the package for the same reason as ResetPasswordPage: the register and
// resend routes generate `${appBaseUrl()}/verify-email?token=…`, so the package
// dictates the route and must therefore supply the page.
//
// The token is consumed by POSTing it to the API, which marks the address
// verified and signs the user in — so this does a FULL navigation afterwards to
// apply the httpOnly session cookie the server just set.

export default function VerifyEmailPage({ accent = '#111827', redirectTo = '/' }) {
  const router = useRouter();
  const [state, setState] = useState('working'); // working | done | failed
  const [message, setMessage] = useState('');
  const [resendEmail, setResendEmail] = useState('');
  const [resendNotice, setResendNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!router.isReady || attempted.current) return;
    const token = router.query.token;

    if (!token) {
      setState('failed');
      setMessage('This verification link is missing its token.');
      return;
    }

    // React 18 StrictMode double-invokes effects in dev; the token is single-use,
    // so guard against consuming it twice.
    attempted.current = true;

    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setState('failed');
          setMessage(data.error || 'This verification link is invalid or has expired.');
          return;
        }

        setState('done');
        setTimeout(() => { window.location.href = redirectTo; }, 1200);
      } catch {
        setState('failed');
        setMessage('Network problem — please check your connection and try again.');
      }
    })();
  }, [router.isReady, router.query.token, redirectTo]);

  const handleResend = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail }),
      });
      const data = await res.json().catch(() => ({}));
      setResendNotice(data.message || 'If that address needs verifying, a new link is on its way.');
    } catch {
      setResendNotice('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageShell accent={accent}>
      {state === 'working' && (
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-gray-400" strokeWidth={2} />
          <h1 className="text-2xl font-semibold text-gray-900">Verifying your email…</h1>
        </div>
      )}

      {state === 'done' && (
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" strokeWidth={2} />
          <h1 className="text-2xl font-semibold text-gray-900">Email verified</h1>
          <p className="mt-2 text-gray-600">You&rsquo;re signed in — taking you through.</p>
        </div>
      )}

      {state === 'failed' && (
        <div>
          <div className="text-center">
            <XCircle className="mx-auto mb-3 h-8 w-8 text-red-600" strokeWidth={2} />
            <h1 className="text-2xl font-semibold text-gray-900">Verification failed</h1>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
          </div>

          <form onSubmit={handleResend} className="mt-6 space-y-3">
            <label htmlFor="resend-email" className="block text-sm font-medium text-gray-700">
              Send a new link
            </label>
            <input
              id="resend-email"
              type="email"
              autoComplete="email"
              required
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="you@example.com"
              className={authField}
            />

            {resendNotice && (
              <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                {resendNotice}
              </p>
            )}

            <button type="submit" disabled={busy} className={authPrimaryButton}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />}
              {busy ? 'Sending…' : 'Resend verification email'}
            </button>
          </form>

          <a
            href="/signin"
            className="mt-5 block text-center text-sm font-semibold text-[var(--auth-accent)] underline underline-offset-4 hover:brightness-110"
          >
            Back to sign in
          </a>
        </div>
      )}
    </AuthPageShell>
  );
}
