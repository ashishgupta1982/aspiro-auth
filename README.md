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
button for a spinner and "Signing in with Google…", disables the rest, and warms
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

## Migrating an existing app

Six apps have been through this. The steps are mechanical; the traps below are
not, and every one of them fails **silently**.

### The eleven traps

1. **Tailwind must scan the package.** Add
   `'./node_modules/@aspiro/auth/src/**/*.{js,jsx}'` to `content`. Without it
   none of the dialog's classes are generated, so it renders unpositioned and
   invisible — the button appears to do nothing, and nothing errors.
2. **`transpilePackages: ['@aspiro/auth']`** in `next.config.mjs`, since this
   package ships raw JSX rather than a build output.
3. **`next lint` does not resolve imports.** Two ChessMaster deploys failed on a
   missing `bcryptjs` while lint passed clean. Every one of the last four
   migrations was missing at least one peer. Resolve every bare import before
   pushing, and confirm the deployment actually reached READY.
4. **Exclude `/reset-password` and `/verify-email` from any auth gate.** They are
   opened by people with no session, arriving from an email. A gate eats the link
   and bounces it to `/signin`.
5. **`/signin` cannot be deleted**, however obsolete it looks once the landing
   page has its own modal. `pages: { signIn, error }` points at it, as do the
   middleware, `/admin`'s guard and `_app`'s bare-pages list. Rebuild it around
   the shared dialog instead — and have it surface `?error=`, which nothing read
   before, so failed provider sign-ins looked like a silent no-op.
6. **Keep the brand in its own file.** `brand.js` with **no imports**, shared by
   the server (emails) and the client (dialog accent). Importing it from
   `auth.js` drags mongoose, the Mongo adapter and bcrypt into the browser
   bundle.
7. **Don't use `file:` linking for local work.** It needs devDependencies in the
   package *and* `resolve.symlinks = false` in the app, and gives
   two-copies-of-React errors when either is missing. Tag and bump instead.
8. **The second app audits the first.** Extraction silently promotes
   app-specific things into shared ones and nothing reveals it until someone
   else uses them. This package's verification email shipped with "Then link
   your chess.com username and we'll start analysing your games" — extracted
   verbatim from ChessMaster, and about to go to CookBook's users. After
   extracting anything, read **every user-facing string** and ask: would app two
   say this? What fails goes back to the app as config (`brand.verifyNote`).
9. **A session callback that provisions cannot move to `onSignIn`.**
   `events.signIn` fires only for **provider** sign-ins, so a user arriving via
   the password, verification or reset routes would never be provisioned and
   would land on a broken page. Put it in `onSession`, which runs on every
   session read however the session was minted. Note the ordering: the package
   sets `session.user.id` from the adapter user *before* `onSession` runs, so a
   callback that creates the document must set it again.
10. **Every app has a different way of eating the emailed links.** Don't look for
    middleware — look for *whatever this app does to a signed-out visitor*:

    | App | What would have eaten the link |
    |---|---|
    | ChessMaster, RunCoach | `middleware.js` matcher |
    | MoneyHub | `_app.js` redirect sending every signed-out visitor to `/signin` |
    | CookBook, DoIt, Tutor App | a `noLayoutPages` / bare-pages list (cosmetic, but still needed) |

11. **One app's local fix is not evidence the package needs it.** MoneyHub had a
    3s ceiling on its session DB lookup, from a real incident. Promoting it here
    was wrong twice over: it was the *least* important of that incident's three
    fixes (the real ones were seeding the session from the adapter user, and
    `serverSelectionTimeoutMS` on the Mongo client), and this package **cannot**
    set `serverSelectionTimeoutMS` — the app builds its own client and hands the
    finished promise over. A stopwatch in here measured a problem it had no
    ability to prevent.

    > The test: **would this be in the package if the app I found it in didn't
    > exist?** If no, it is that app's fix, not the suite's.

### Prerequisites most apps were missing

- **A rate limiter exporting `getClientIP`.** Three of six had the function but
  never exported it. None had an `AUTH_API` bucket (10 attempts / 15 min / IP).
  Add both to the app's existing limiter rather than replacing the file — other
  routes depend on its other buckets.
- **`authFields` spread into the `User` model** — from `@aspiro/auth/model`.
- **`RESEND_API_KEY` + `EMAIL_FROM` set in Vercel.** Missing env vars are the
  single most common reason "email isn't sending"; the routes log the link to the
  server console instead and carry on, so nothing errors.

### As built, per app

| App | What wasn't standard |
|---|---|
| ChessMaster | First migration. `/signin` was load-bearing in five places (trap 5). |
| CookBook | The original template these files came from. `requireName: true` — recipes are shared and followed, so an account with no name has nothing to put on a card. |
| Tutor App | Its session callback **provisioned** — created the User doc, backfilled seven fields, auto-created a default student (trap 9). Returns early on `enrichFailed`. Its student claim flow re-points `accounts`/`sessions` directly and is untouched by the migration. |
| RunCoach | Carried an Azure AD provider no UI ever offered, since deleted. Keeps a throttled `lastLoginAt` refresh in `onSession`, because `events.signIn` never fires for a returning user with a live session. |
| DoIt | Nothing — the cleanest of the six. |
| MoneyHub | Trap 11. Keeps `serverSelectionTimeoutMS: 8000` in its own Mongo config, where it belongs. |

Out of scope: **GolfSoc** (uses `CredentialsProvider` and a placeholder-claim
flow this package deliberately doesn't cover), **VocabularyBuilder** (stays
forked for its Teams build), **GamePad** (deferred), **Aspiro Homepage** (auth
deleted outright — it was a static brochure site carrying NextAuth, Mongo and a
Teams SSO endpoint for a settings page that showed you your own email address).

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
