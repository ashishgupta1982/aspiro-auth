import { useState } from 'react';
import { useRouter } from 'next/router';
import { CheckCircle2, Loader2 } from 'lucide-react';
import AuthPageShell, { authField, authPrimaryButton } from './AuthPageShell.jsx';

// Landing page for the emailed password-reset link.
//
// This lives in the package because the package GENERATES the URL that points
// here (`${appBaseUrl()}/reset-password?token=…` in the forgot-password route).
// An app that has the route but not the page fails silently: the emailed link
// 404s, or worse gets swallowed by middleware, and nothing in the code says so.
// ChessMaster shipped exactly that.
//
// Also the supported way to ADD a password to an account that currently signs in
// with Google or Apple only — completing this proves control of the mailbox,
// which is the proof registration deliberately refuses to accept.
//
// On success the server revokes every other session and signs this device in, so
// this does a FULL navigation to pick up the httpOnly cookie the server just set.

export default function ResetPasswordPage({ accent = '#111827', redirectTo = '/' }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;

    if (password !== confirm) {
      setError('Those passwords don’t match.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: router.query.token, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      setDone(true);
      setTimeout(() => { window.location.href = redirectTo; }, 1200);
    } catch {
      setError('Network problem — please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPageShell accent={accent}>
      {done ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" strokeWidth={2} />
          <h1 className="text-2xl font-semibold text-gray-900">Password updated</h1>
          <p className="mt-2 text-gray-600">You&rsquo;re signed in — taking you through.</p>
        </div>
      ) : (
        <>
          <h1 className="text-center text-2xl font-semibold text-gray-900">
            Choose a new password
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            This signs you out everywhere else.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="new-password" className="sr-only">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password (8+ characters)"
                className={authField}
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className="sr-only">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirm new password"
                className={authField}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className={authPrimaryButton}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />}
              {busy ? 'Saving…' : 'Save new password'}
            </button>
          </form>

          <a
            href="/signin"
            className="mt-5 block text-center text-sm font-semibold text-[var(--auth-accent)] underline underline-offset-4 hover:brightness-110"
          >
            Back to sign in
          </a>
        </>
      )}
    </AuthPageShell>
  );
}
