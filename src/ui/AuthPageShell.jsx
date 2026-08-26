// Shared chrome for the two full-page auth landings (reset password, verify
// email). Same visual language as SignInDialog: its own typography set inline,
// neutral greys, and one brand accent passed in.
//
// These are PAGES rather than dialogs because the user arrives from an email
// link with no app context around them.

export const AUTH_FONT = { fontFamily: 'Arial, Helvetica, sans-serif' };

export default function AuthPageShell({ accent = '#111827', children }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-16"
      style={{ ...AUTH_FONT, '--auth-accent': accent }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
        {children}
      </div>
    </main>
  );
}

export const authField =
  'w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-gray-900 placeholder-gray-400 ' +
  'focus:outline-none focus:border-[var(--auth-accent)] focus:ring-2 focus:ring-[var(--auth-accent)]/30';

export const authPrimaryButton =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--auth-accent)] px-4 py-2.5 font-medium ' +
  'text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-[var(--auth-accent)] focus-visible:ring-offset-2 disabled:opacity-70';
