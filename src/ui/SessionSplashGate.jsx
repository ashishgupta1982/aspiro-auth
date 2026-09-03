import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

// Full-screen branded overlay held while the NextAuth session resolves.
//
// On first load useSession() reports 'loading' for a few hundred milliseconds.
// Rendering the landing page or an empty shell during that window, then
// swapping to the real page, produces a visible flash — and a redirect hop
// from home to sign-in makes it worse. This gate covers that window: mount it
// once in _app inside SessionProvider, render the correct destination
// UNDERNEATH it (unauthenticated → the sign-in landing, authenticated → the
// app shell), and the hand-off reads as one motion rather than a cut.
//
// Timing: the overlay stays up until the session status is no longer
// 'loading' AND a minimum of `minMs` has passed — the minimum stops a fast
// answer from flashing the splash itself. It then fades out over 300ms with
// pointer-events disabled, and unmounts shortly after.
//
// The timers run from MOUNT, not from route changes. So mount it
// unconditionally and drive visibility with `active` (is the current route an
// app route): a visitor who lands on /signin and later navigates into the app
// never sees a stale splash, because by then the gate has already left.
//
// Designed for a dark ground. Pass the brand's own via `groundClassName`.
//
// The host app's Tailwind build must scan this package's source (see README);
// the classes here are utilities plus one arbitrary value (z-[500]).

const FADE_UNMOUNT_MS = 320; // fade is 300ms; unmount just after it completes

export default function SessionSplashGate({
  active = true,
  minMs = 600,
  appName,
  iconSrc,
  wordmark,
  label = 'Signing you in…',
  groundClassName = 'bg-slate-950',
}) {
  const { status } = useSession();

  const [minElapsed, setMinElapsed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), minMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- minimum is measured from mount, once
  }, []);

  const leaving = minElapsed && status !== 'loading';

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setGone(true), FADE_UNMOUNT_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  if (!active || gone) return null;

  return (
    <div
      aria-busy="true"
      aria-label={label.replace(/…$/, '')}
      className={`fixed inset-0 z-[500] flex flex-col items-center justify-center gap-5 transition-opacity duration-300 motion-reduce:transition-none ${groundClassName} ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex items-center gap-2.5">
        {iconSrc ? <img src={iconSrc} alt="" className="h-9 w-9 rounded-xl" /> : null}
        {wordmark ?? <span className="text-2xl font-bold text-white">{appName}</span>}
      </div>
      <div className="flex items-center gap-2 text-sm text-slate-400">
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-white"
          aria-hidden="true"
        />
        {label}
      </div>
    </div>
  );
}
