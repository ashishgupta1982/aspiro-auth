# @aspiro/auth

Google + Apple + email/password sign-in for the Aspiro app suite. NextAuth v4,
MongoDB adapter, **database sessions**.

Extracted from ChessMaster on 2026-08-26 — the canonical copy at the time, and
the only one passing all seven checks in the vault's `Indie-Dev/Auth` audit.

## The one rule

**All three providers ship in every app. There is no capability selection.**

Apple *registers itself* only when `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`,
`APPLE_KEY_ID` and `APPLE_PRIVATE_KEY` are all present, and stays dormant
otherwise. So an app gets Apple by adding env vars — never by changing code.

Why fixed rather than configurable: the dangerous parts of auth are the
*interactions*, not the capabilities. The account-takeover path found in
ChessMaster on 2026-08-26 existed because Google and email were both enabled and
the rule binding them was never wired, and nothing in the code could reveal the
absence. With the set fixed, those rules are unconditional — they cannot be
forgotten in app number twelve.

## Install

```bash
npm i github:ashishgupta1982/aspiro-auth
```

Then **two** config changes. Both are required; miss either and it fails quietly.

**1. `next.config.mjs`** — the package ships plain ESM + JSX with no build step,
so Next has to compile it:

```js
const nextConfig = {
  transpilePackages: ['@aspiro/auth'],
};
```

**2. `tailwind.config.mjs`** — Tailwind only generates classes it can SEE, and by
default it never looks inside `node_modules`:

```js
content: [
  './src/**/*.{js,jsx}',
  './node_modules/@aspiro/auth/src/**/*.{js,jsx}',   // ← required
],
```

⚠️ **Skip that second one and the dialog breaks in the most confusing way
possible.** None of its utility classes are emitted, so it renders with no
positioning, no background and no size — invisible. The button appears to do
nothing. Nothing errors, nothing warns, and the DOM node is actually there.
This cost a debugging session on ChessMaster on 2026-08-26.

Restart the dev server after changing either file.

## Use

One config file per app. This is the only auth code an app writes:

```js
// src/lib/auth.js
import { createAuth } from '@aspiro/auth';
import dbConnect from './mongodb';
import clientPromise from './mongodb-adapter';
import User from '../models/User';
import { checkRate, getClientIP } from '../utils/rateLimiter';

export const auth = createAuth({
  brand: {
    name: 'ChessMaster',
    colour: '#0B7E62',                             // email HTML — clients can't read Tailwind
    url: 'https://chess.aspiro-consulting.co.uk',  // link fallback when NEXTAUTH_URL is unset
    // Optional: one sentence appended to the VERIFICATION email, saying what
    // this app wants the user to do next. Any copy specific to your app goes
    // here — never inside the package's own templates.
    verifyNote: 'Then link your chess.com username and we’ll start analysing your games.',
  },
  models: { User },
  dbConnect,
  clientPromise,
  rateLimit: { checkRate, getClientIP },

  // Optional
  requireName: false,
  // `dbUser` is null if there is no such document OR if the lookup failed —
  // `enrichFailed` tells the two apart. A session enrich failure is never fatal:
  // the session still resolves from the adapter's own user document. Only an
  // onSession that PROVISIONS needs to care.
  onSession: ({ session, dbUser, enrichFailed }) => {
    if (enrichFailed) return session;
    session.user.role = dbUser?.role ?? 'user';
    session.user.isAdmin = dbUser?.isAdmin ?? false;
    return session;
  },
});

export const { authOptions } = auth;
```

### Routes

In the pages router a static file takes precedence over the `[...nextauth]`
catch-all — which is why the split works, and also why these six cannot collapse
into one dispatcher. They are three-line re-exports that never change again:

```js
// src/pages/api/auth/login.js
import { auth } from '../../../lib/auth';
export default auth.login;
```

Same shape for `register`, `verify-email`, `forgot-password`, `reset-password`,
`resend-verification`. And:

```js
// src/pages/api/auth/[...nextauth].js
import NextAuth from 'next-auth';
import { authOptions } from '../../../lib/auth';
export { authOptions };
export default NextAuth(authOptions);
```

### User model

```js
import { authFields } from '@aspiro/auth/model';

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  ...authFields,
  // app-specific fields here
});
```

### The two email landing pages

The package generates the URLs these serve (`/reset-password?token=…` and
`/verify-email?token=…`), so it supplies the pages too. An app that has the API
routes but not the pages fails **silently** — the emailed link 404s, or gets
swallowed by middleware, and nothing in the code says so. ChessMaster shipped
exactly that.

```jsx
// src/pages/reset-password.js
import { ResetPasswordPage } from '@aspiro/auth/ui';
import { BRAND } from '../lib/brand';
export default function ResetPassword() {
  return <ResetPasswordPage accent={BRAND.colour} />;
}
```

The dialog handles its own in-flight state: clicking a provider swaps that
button for a spinner and "Taking you to Google…", disables the rest, and warms
`/api/auth/csrf` when it opens. `signIn()` is not a redirect — NextAuth makes
two round trips to your own server before the page moves — so without this the
button looks broken for a second or more. Apps need pass nothing; the optional
`isAuthenticating` prop still works as an override.

Same shape for `verify-email.js` with `VerifyEmailPage`.

⚠️ **If the app has middleware, exclude both paths from its matcher.** They are
reached by unauthenticated users arriving from an email, so an auth redirect will
eat them before the page renders.

### UI

```jsx
import { SignInDialog } from '@aspiro/auth/ui';

<SignInDialog
  open={open}
  onOpenChange={setOpen}
  title="Sign in to ChessMaster"
  description="Track your games and get AI coaching."
  appleEnabled={process.env.NEXT_PUBLIC_APPLE_ENABLED === 'true'}
  onSignIn={handleSignIn}
/>
```

The dialog sets its own typography inline and uses only neutral greys, so it
looks identical in every app and cannot inherit a host app's Tailwind config.
That is deliberate: classes like CookBook's `shadow-soft` exist in one repo's
config and are simply not emitted in another — the styling would vanish with no
error.

## What the app still owns

Not everything belongs here. Each app keeps its own:

- `dbConnect` / `clientPromise` / `User` model
- rate limiter (the package uses the app's `AUTH_API` bucket — 10 per 15 min per IP)
- `authHelper.js` — `getAuthenticatedUser` / `getEffectiveUserId`
- Resend env vars: `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`

## Not covered

- **GolfSoc** — invite/placeholder-claim flow; the only real behavioural fork.
- **VocabularyBuilder** — Teams SSO. `@microsoft/teams-js` is 5 MB and used by
  one app; a shared dependency would cost every other app that for nothing.

## Related

Design, rationale and the audit checklist: the vault's
`40-Areas/Indie-Dev/Dev-Foundations/Auth.md`.
