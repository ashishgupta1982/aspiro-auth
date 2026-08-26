import { useState } from 'react';
import { Loader2, Mail, ArrowLeft } from 'lucide-react';

// First-party email + password auth, as a self-contained panel.
//
// Styled for a LIGHT surface: it sits inside SignInDialog, below the provider
// buttons. It first rendered on CookBook's amber hero, which is why it was once
// all white-on-transparent.
//
// The palette is deliberately NEUTRAL GREY, not the host app's brand. This whole
// dialog is meant to look the same in every app, so nothing here should say
// "CookBook". Typography is inherited from the dialog, which sets it inline.
//
// It talks to plain API routes (not next-auth/react's signIn) because this app
// uses database sessions: the server sets an httpOnly session cookie, so every
// success path does a FULL navigation rather than a client-side route change —
// the same reason the Demo Access button navigates. That also keeps it working
// inside the native webview, with no Safari sheet involved.
//
// Reusable across the app suite as-is; nothing here is CookBook-specific.

const MODES = { SIGNIN: 'signin', REGISTER: 'register', FORGOT: 'forgot' };

export default function EmailAuthPanel({ onCancel }) {
  const [mode, setMode] = useState(MODES.SIGNIN);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showResend, setShowResend] = useState(false);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
    setShowResend(false);
    setPassword('');
  };

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setShowResend(false);

    try {
      if (mode === MODES.SIGNIN) {
        const { ok, data } = await post('/api/auth/login', { email, password });
        if (!ok) {
          setError(data.error || 'Something went wrong. Please try again.');
          if (data.code === 'unverified') setShowResend(true);
          return;
        }
        // Full navigation so the server-set session cookie takes effect.
        window.location.href = '/';
        return;
      }

      if (mode === MODES.REGISTER) {
        const { ok, data } = await post('/api/auth/register', { name, email, password });
        if (!ok) {
          setError(data.error || 'Something went wrong. Please try again.');
          return;
        }
        setNotice(data.message);
        setPassword('');
        return;
      }

      const { ok, data } = await post('/api/auth/forgot-password', { email });
      if (!ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }
      setNotice(data.message);
    } catch {
      setError('Network problem — please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await post('/api/auth/resend-verification', { email });
      setNotice(data.message || 'If that address needs verifying, a new link is on its way.');
      setShowResend(false);
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const heading = {
    [MODES.SIGNIN]: 'Sign in with email',
    [MODES.REGISTER]: 'Create an account',
    [MODES.FORGOT]: 'Reset your password',
  }[mode];

  const cta = {
    [MODES.SIGNIN]: 'Sign in',
    [MODES.REGISTER]: 'Create account',
    [MODES.FORGOT]: 'Send reset link',
  }[mode];

  const field =
    'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 ' +
    'focus:outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-400/40';

  return (
    <div className="w-full text-left">
      <div className="mb-3 flex items-center gap-2">
        <Mail className="h-4 w-4 text-gray-500" strokeWidth={2} aria-hidden="true" />
        <h2 className="text-sm font-semibold text-gray-900">{heading}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {mode === MODES.REGISTER && (
          <div>
            <label htmlFor="auth-name" className="sr-only">Name</label>
            <input
              id="auth-name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={field}
            />
          </div>
        )}

        <div>
          <label htmlFor="auth-email" className="sr-only">Email</label>
          <input
            id="auth-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={field}
          />
        </div>

        {mode !== MODES.FORGOT && (
          <div>
            <label htmlFor="auth-password" className="sr-only">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === MODES.REGISTER ? 'new-password' : 'current-password'}
              required
              minLength={mode === MODES.REGISTER ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === MODES.REGISTER ? 'Password (8+ characters)' : 'Password'}
              className={field}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
            {notice}
          </p>
        )}

        {showResend && (
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="text-sm font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900"
          >
            Resend the verification email
          </button>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />}
          {busy ? 'Please wait…' : cta}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-gray-600">
        {mode === MODES.SIGNIN && (
          <>
            <button type="button" onClick={() => switchMode(MODES.REGISTER)} className="font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900">
              Create an account
            </button>
            <button type="button" onClick={() => switchMode(MODES.FORGOT)} className="underline underline-offset-4 hover:text-gray-900">
              Forgot password?
            </button>
          </>
        )}

        {mode !== MODES.SIGNIN && (
          <button
            type="button"
            onClick={() => switchMode(MODES.SIGNIN)}
            className="inline-flex items-center gap-1 font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
            Back to sign in
          </button>
        )}

        {onCancel && (
          <button type="button" onClick={onCancel} className="ml-auto hover:text-gray-900">
            Back to all options
          </button>
        )}
      </div>
    </div>
  );
}
