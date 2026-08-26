import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import EmailAuthPanel from './EmailAuthPanel.jsx';

// Radix is used directly rather than through an app's local ui/dialog wrapper:
// those wrappers carry app-specific Tailwind (CookBook's shadow-soft-xl and
// font-display, for instance), and classes defined in one app's tailwind.config
// are simply not emitted in another — the styling would vanish silently.

// Every way into the app, in one modal — the same modal in every app.
//
// This replaces the old inline cluster, where Google and Apple sat on the page
// and "Or sign in with email" expanded a panel in place — which pushed the hero
// around and meant the page had two independent copies of the sign-in options.
// One dialog, opened from any number of CTAs, cannot drift out of step with
// itself.
//
// Providers are rendered only when they are actually configured, so nothing here
// ever shows a button that can't work. CookBook has Google, Apple (once the env
// vars are set) and email + password; an app with a different set passes
// different flags.
//
// Built on the app's own Radix dialog rather than a hand-rolled overlay, so it
// gets a focus trap, Esc-to-close and a labelled close button for free.

// The dialog sets its own typography rather than inheriting the host app's.
//
// That is the point of it: this surface should look the same in every app, so it
// must not pick up CookBook's Fraunces headings, RunCoach's stack, or anyone
// else's. Matches VocabularyBuilder's modal, which is the reference.
//
// Applied as an INLINE STYLE, deliberately. A class would lose to `.font-display`
// in globals.css, which is declared after the Tailwind utilities and wins on
// source order at equal specificity — silently, with nothing raised anywhere.
// Inline beats every class, so it needs no `!important` and cannot be undone by
// whatever CSS the host app happens to load.
const DIALOG_FONT = { fontFamily: 'Arial, Helvetica, sans-serif' };

const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const AppleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
);

export default function SignInDialog({
  open,
  onOpenChange,
  title = 'Sign in',
  description = 'Choose how you would like to sign in.',
  appleEnabled = false,
  isAuthenticating = false,
  onSignIn,
}) {
  // Email starts collapsed: one-tap providers are the common path, and a form
  // unfurled by default makes the dialog tall enough to scroll on a phone before
  // the user has expressed any interest in typing a password.
  const [showEmail, setShowEmail] = useState(false);

  // Reopening should look the way it did the first time, not resume mid-form.
  useEffect(() => {
    if (!open) setShowEmail(false);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[110] grid w-[calc(100%-1.5rem)] max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:max-w-md"
          style={DIALOG_FONT}
        >
        <div className="flex flex-col space-y-1.5 text-center">
          {/* The title needs the style repeated: DialogTitle carries its own
              font-family via `font-display`, and inheritance from the parent
              cannot override a rule set on the element itself. */}
          <DialogPrimitive.Title className="text-xl font-semibold tracking-normal text-gray-900" style={DIALOG_FONT}>
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-base text-gray-600">
            {description}
          </DialogPrimitive.Description>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => onSignIn('google', '/')}
            disabled={isAuthenticating}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {appleEnabled && (
            <button
              type="button"
              onClick={() => onSignIn('apple', '/')}
              disabled={isAuthenticating}
              className="flex w-full items-center justify-center gap-3 rounded-lg bg-black px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 disabled:opacity-60"
            >
              <AppleIcon />
              Continue with Apple
            </button>
          )}
        </div>

        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-gray-200" />
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">or</span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        {/* Email is deliberately NOT a third button. Google and Apple are one tap
            and are what most people will use; giving email the same visual weight
            implies they are equal choices and makes the dialog read as three
            competing options. A quiet link under the separator offers it without
            advertising it, and expands the form in place when taken. */}
        {showEmail ? (
          // No onCancel: the provider buttons stay visible directly above, so a
          // "back to all options" link would point at something already on
          // screen. The dialog's close button is the way out.
          <EmailAuthPanel />
        ) : (
          <div className="text-center">
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="rounded text-sm font-medium text-gray-600 underline underline-offset-4 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
            >
              Sign in with email
            </button>
          </div>
        )}

        <p className="text-center text-xs leading-relaxed text-gray-600">
          By continuing you agree to our{' '}
          <a href="/terms" className="underline underline-offset-2 hover:text-gray-900">Terms</a>
          {' '}and{' '}
          <a href="/privacy" className="underline underline-offset-2 hover:text-gray-900">Privacy Policy</a>.
        </p>

          <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
