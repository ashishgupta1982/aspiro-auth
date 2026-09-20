# @aspiro/auth

Sign-in for the whole suite — Google, Apple and email + password over one
NextAuth v4 database-session model, plus the credential routes, the sign-in
dialog and the verify/reset pages. Eleven apps depend on it, which makes this
the highest-blast-radius repo in the projects root: a mistake here is an
account-takeover path in eleven products at once.

## Read this first — three docs, three jobs

| You are doing | Read |
|---|---|
| Deciding how auth *should* work, or auditing it | vault `40-Areas/Indie-Dev/10-Foundations/Foundations-Authentication.md` |
| Wiring this into an app, or migrating one | `README.md` — the config contract, the traps, per-app state |
| Changing this package | this file |

**The vault is the record.** Read it before migrating another app or changing
anything about the provider set. Don't restate it here or in the README.

## The one rule, and why it is not configurable

**All three providers ship in every app. There is no capability selection.**
Apple registers itself only when its four env vars are present and stays dormant
otherwise — so an app gains Apple by adding env vars, never by changing code.

The dangerous parts of auth are the *interactions*, not the capabilities. The
account-takeover path found in ChessMaster on 2026-08-26 existed because Google
and email were both enabled and the rule binding them was never wired — and
nothing in the code could reveal the absence. With the set fixed, those rules
are unconditional and cannot be forgotten in app number twelve.

**Never add a flag that turns a provider off.** That is the whole design.

## Editing this package changes nothing on its own

**Apps pin a tagged tarball**, so a fix reaches an app only when a tag is cut
*and* that app's pin is bumped:

```jsonc
"@aspiro/auth": "https://github.com/ashishgupta1982/aspiro-auth/archive/refs/tags/v0.8.0.tar.gz"
```

**Never `github:owner/repo`** — npm writes `git+ssh://` into the lockfile and
the Vercel build fails.

Read the live pins rather than trusting a list, including one written here:

```bash
grep -h '"@aspiro/auth"' ../*/package.json
```

Every app is on the same version today. Keep it that way where you can: this is
the one package where a security fix that reaches only half the suite is worse
than useless, because it reads as done.

## Releasing

1. Change the code; update the README if the config contract moved.
2. Bump `version` in `package.json`.
3. Commit, then `git tag vX.Y.Z && git push && git push --tags`. **The tag is
   the release** — without it the tarball URL 404s.
4. Bump each consuming app deliberately, and confirm its Vercel deployment
   actually reached READY.

**`next lint` does not resolve imports.** A missing peer dependency passes lint
in the app and fails the Vercel build. This trap caught every single app during
the first migration — resolve every bare import before pushing, and never treat
a green lint as evidence the build works.

## Layout

```
src/
├── index.js                 createAuth() — what an app calls
├── model/authFields.js      the fields an app's User model must carry
├── server/
│   ├── nextauth.js          provider assembly + the linking rules
│   ├── session.js           database sessions via the Mongo adapter
│   ├── password.js          hashing + verification
│   ├── verificationToken.js single-use tokens
│   ├── email.js             Resend delivery
│   └── routes/              the six credential routes
└── ui/                      SignInDialog, the two landing pages, the splash gate
```

**Four entry points:** `@aspiro/auth`, `/ui`, `/splash`, `/model`. The splash
gate has its own subpath so an app can use it without the dialog's optional
peers — that is why GolfSoc can take the gate without taking the dialog.

## Rules that must not be undone

- **Never NextAuth's `CredentialsProvider`.** These apps use *database*
  sessions; that provider only supports JWT, so adopting it logs every existing
  user out and removes server-side revocation and admin impersonation. Email +
  password is a plain API route that verifies the password and mints a DB
  session through the adapter. GolfSoc has an older CredentialsProvider/JWT
  variant — working, but never copy it into a database-session app.
- **Password login is refused until `emailVerified` is set.** Every app sets
  `allowDangerousEmailAccountLinking: true`, so without this someone registers a
  password on an address they do not own and is merged into the real owner's
  account the moment that person signs in with Google. This is the takeover path
  — it is load-bearing, not polish.
- **An OAuth sign-in clears an unverified password** on that account. Users add
  a password through Forgot password, which proves mailbox control first.
- **The app keeps its own `dbConnect`, `User` model, rate limiter and
  `authHelper.js`.** Pulling those in here would make the package need to know
  each app's data layer.

## Deliberate exceptions — don't "align" them

- **GolfSoc** — invite and placeholder-claim flow; the only real behavioural
  fork in the suite.
- **VocabularyBuilder** — Teams SSO. `@microsoft/teams-js` is 5 MB and used by
  one app; sharing it would cost every other app that for nothing. It also keeps
  its own in-component session gate, tangled with Teams and load-bearing.
- **RunCoach and ChessMaster have no `src/middleware.js`** — those edge
  redirects were deleted deliberately when the splash gate took over the
  signed-out case in place. Don't reintroduce them.

## Gotchas

- **`src/lib/brand.js` in a consuming app must have no imports.** It is read in
  contexts where a transitive import would break the build.
- **This package ships React components**, unlike `@aspiro/media` — a consuming
  app needs it in `transpilePackages` and in the Tailwind content glob, or the
  dialog renders unstyled.
