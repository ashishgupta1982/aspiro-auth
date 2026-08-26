import GoogleProviderModule from 'next-auth/providers/google';
import AppleProviderModule from 'next-auth/providers/apple';
import jwtModule from 'jsonwebtoken';
import { MongoDBAdapter } from '@next-auth/mongodb-adapter';

// next-auth's provider modules and jsonwebtoken are CommonJS. Bundlers apply
// the CJS/ESM interop for you, which is why this is invisible inside a Next app
// — but this package is plain ESM and must also work under raw Node (tests,
// scripts). Without the unwrap, `GoogleProvider` is `{ default: fn }` and calling
// it throws "GoogleProvider is not a function".
const GoogleProvider = GoogleProviderModule.default ?? GoogleProviderModule;
const AppleProvider = AppleProviderModule.default ?? AppleProviderModule;
const jwt = jwtModule.default ?? jwtModule;

// The NextAuth options every app shares.
//
// Extracted from ChessMaster on 2026-08-26. The three providers are FIXED —
// Google, Apple and email + password, in every app, not configurable. That is
// what keeps this small: with a fixed set there is no capability registry and,
// more importantly, no combination logic. The interaction rules below are
// unconditional rather than something each app has to remember to wire.

// Apple client secrets expire (max 6 months), so generate a fresh one from the
// Sign in with Apple key (.p8) on each boot rather than pasting a static JWT that
// would silently break sign-in later. Set the key + IDs once and it self-renews.
function appleClientSecret() {
  return jwt.sign({}, process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), {
    algorithm: 'ES256',
    keyid: process.env.APPLE_KEY_ID,
    issuer: process.env.APPLE_TEAM_ID,
    audience: 'https://appleid.apple.com',
    subject: process.env.APPLE_SERVICES_ID, // the Services ID = web clientId
    expiresIn: '180d',
  });
}

/**
 * Build the NextAuth options for an app.
 *
 * @param {object} ctx - { dbConnect, User, clientPromise, onSession, onSignIn, pages }
 */
export function buildAuthOptions(ctx) {
  const { dbConnect, User, clientPromise, onSession, onSignIn, pages } = ctx;

  // `allowDangerousEmailAccountLinking` lets a user who signs in with Apple land on
  // the SAME account as their Google login when the verified email matches — one
  // person = one account. Safe here because Google and Apple both return verified
  // emails. (Edge: Apple "Hide My Email" gives a relay address that won't match.)
  const providers = [
    GoogleProvider({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  ];

  // Apple ships in every app but only REGISTERS once its key + IDs exist.
  //
  // This guard is load-bearing, not housekeeping: appleClientSecret() calls
  // .replace() on process.env.APPLE_PRIVATE_KEY, which throws at module load in
  // an app with no Apple credentials — taking down the whole [...nextauth] route
  // and Google sign-in with it. Never register the provider unguarded.
  const appleConfigured =
    process.env.APPLE_SERVICES_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY;

  if (appleConfigured) {
    providers.push(
      AppleProvider({
        clientId: process.env.APPLE_SERVICES_ID,
        clientSecret: appleClientSecret(),
        allowDangerousEmailAccountLinking: true,
      })
    );
  }

  // Apple returns its callback as a CROSS-SITE POST (response_mode=form_post from
  // appleid.apple.com). The default SameSite=Lax state/PKCE/nonce cookies aren't sent
  // on that request, so NextAuth fails with `OAuthCallback`. On HTTPS we relax just
  // those three to SameSite=None; Secure. Google (top-level GET) + local dev unaffected.
  const useSecureCookies = process.env.NODE_ENV === 'production';
  const crossSiteOptions = { httpOnly: true, sameSite: 'none', path: '/', secure: true };
  const appleFriendlyCookies = useSecureCookies
    ? {
        state: { name: '__Secure-next-auth.state', options: crossSiteOptions },
        pkceCodeVerifier: { name: '__Secure-next-auth.pkce.code_verifier', options: crossSiteOptions },
        nonce: { name: '__Secure-next-auth.nonce', options: crossSiteOptions },
      }
    : undefined;

  return {
    providers,
    adapter: MongoDBAdapter(clientPromise),
    cookies: appleFriendlyCookies,
    pages: { signIn: '/signin', error: '/signin', ...(pages || {}) },

    events: {
      async signIn({ user }) {
        await dbConnect();
        const update = { lastLoginAt: new Date() };
        if (user?.id && /^[a-f0-9]{24}$/i.test(user.id)) {
          await User.findByIdAndUpdate(user.id, { $set: update });
        } else if (user?.email) {
          await User.findOneAndUpdate({ email: user.email }, { $set: update });
        }

        // ── The rule that makes Google + email safe together ──────────────────
        //
        // Google and Apple both return verified addresses, so an OAuth sign-in
        // proves ownership — record it.
        //
        // The `$unset` is the important half. `allowDangerousEmailAccountLinking`
        // means a Google sign-in lands on any existing account with the same
        // email, INCLUDING one someone else created by registering a password on
        // an address they didn't own. That password was never verified, so it was
        // never proven to belong to anyone. Marking the address verified without
        // clearing it would promote that stranger's credential into a working
        // login on the real owner's account. Dropping it costs a legitimate user
        // nothing — they can set a password any time via "Forgot password", which
        // proves mailbox control first.
        //
        // This lived in each app and was MISSING from ChessMaster until
        // 2026-08-26. Nothing in the code could reveal its absence, which is
        // precisely why it belongs here rather than in a checklist.
        if (user?.email) {
          const dbUser = await User.findOne({ email: user.email }).select('+password emailVerified');
          if (dbUser && !dbUser.emailVerified) {
            const patch = { $set: { emailVerified: new Date() } };
            if (dbUser.password) {
              patch.$unset = {
                password: '',
                emailVerificationToken: '',
                emailVerificationExpires: '',
              };
            }
            await User.updateOne({ _id: dbUser._id }, patch);
          }
        }

        // Anything else the app needs on a provider sign-in.
        // NOTE: events.signIn fires ONLY for provider sign-ins. Work that must
        // happen on EVERY sign-in has to live in a helper the password,
        // verification and reset routes call too — it will not run here for them.
        if (onSignIn) await onSignIn({ user });
      },
    },

    callbacks: {
      async signIn() {
        return true;
      },
      redirect: async ({ url, baseUrl }) => {
        if (url.startsWith('/')) return `${baseUrl}${url}`;
        if (new URL(url).origin === baseUrl) return url;
        return baseUrl;
      },
      session: async ({ session, user }) => {
        session.userId = user.id;
        await dbConnect();
        const dbUser = await User.findOne({ email: user.email });
        session.user.id = dbUser?._id?.toString() || user.id;

        // Per-app session fields (role, isAdmin, and whatever else the client
        // reads). A field the UI reads but the callback never sets renders as
        // undefined — the UI quietly disappears rather than erroring, which is
        // how GolfSoc lost its whole super-admin surface.
        return onSession ? onSession({ session, user, dbUser }) : session;
      },
    },
  };
}
