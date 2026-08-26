import { verifyPassword, DUMMY_HASH } from '../password.js';
import { createDbSession } from '../session.js';

// Email + password sign-in.
//
// This does NOT use NextAuth's CredentialsProvider, on purpose: that provider
// only works with JWT sessions, and this app uses adapter-backed DATABASE
// sessions. Adopting it would log every existing user out and remove
// server-side session revocation. So we verify the password here and mint a
// database session directly — the session is then indistinguishable from a
// Google or Apple one, and getAuthenticatedUser needs no changes.

const INVALID = 'Invalid email or password';

export function createLoginHandler(ctx) {
  const { dbConnect, User, clientPromise, checkRate, getClientIP } = ctx;

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!checkRate(getClientIP(req), 'AUTH_API').allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: INVALID });
      }

      await dbConnect();
      const emailLower = String(email).toLowerCase().trim();
      const user = await User.findOne({ email: emailLower }).select('+password');

      // Always run a bcrypt compare, even with no user, so response time doesn't
      // reveal whether the address exists.
      const ok = await verifyPassword(String(password), user?.password || DUMMY_HASH);
      if (!user || !user.password || !ok) {
        return res.status(401).json({ error: INVALID });
      }

      // The gate that makes password login safe alongside
      // allowDangerousEmailAccountLinking: an unproven address can never sign in,
      // so it can never be linked to the real owner's Google/Apple account.
      if (!user.emailVerified) {
        return res.status(403).json({
          error: 'Please verify your email address first — check your inbox for the link.',
          code: 'unverified',
        });
      }

      await createDbSession({ clientPromise, userId: user._id.toString(), res });
      await User.findByIdAndUpdate(user._id, { $set: { lastLoginAt: new Date() } });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Login error:', error);
      return res.status(500).json({ error: 'An error occurred during sign in' });
    }
  };
}
