import { hashPassword, validatePassword } from '../password.js';
import { generateVerificationToken } from '../verificationToken.js';
import { sendVerificationEmail, sendAccountExistsEmail, appBaseUrl } from '../email.js';

// First-party sign-up. Google and Apple sign-in are unaffected — they still go
// through NextAuth.
//
// Two deliberate properties:
//
// 1. ENUMERATION-SAFE. The response is identical whether or not the address
//    already has an account, so this endpoint can't be used to discover who is
//    registered. The real owner is told what happened by email instead.
//
// 2. AN EXISTING ACCOUNT IS NEVER MODIFIED. We don't "upgrade" a passwordless
//    OAuth account by attaching a password here — that would let anyone write a
//    credential onto someone else's account. Adding a password to an existing
//    account is done through the password-reset flow, which proves control of
//    the mailbox first.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_OK = 'Check your email — if that address can be registered, a verification link is on its way.';

export function createRegisterHandler(ctx) {
  const { dbConnect, User, clientPromise, checkRate, getClientIP, requireName } = ctx;

  return async function handler(req, res) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!checkRate(getClientIP(req), 'AUTH_API').allowed) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
    }

    try {
      const { name, email, password } = req.body || {};

      if (!email || !EMAIL_RE.test(String(email).trim())) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }

      const strength = validatePassword(password);
      if (!strength.ok) {
        return res.status(400).json({ error: strength.error });
      }

      await dbConnect();

      const emailLower = String(email).toLowerCase().trim();
      // `requireName` is the one behavioural policy that genuinely differed between
      // apps. CookBook hard-failed without a name; ChessMaster fell back to the
      // address local-part, which is the better default — a name is a greeting,
      // not a credential. Apps that want the stricter rule opt in.
      if (requireName && !String(name || '').trim()) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const cleanName = String(name || '').trim().slice(0, 80) || emailLower.split('@')[0];
      const existing = await User.findOne({ email: emailLower }).select('+password name').lean();

      if (existing) {
        // Same response as the success path. Tell the actual owner by email.
        await sendAccountExistsEmail({
          to: emailLower,
          name: existing.name,
          hasPassword: Boolean(existing.password),
        });
        return res.status(201).json({ message: GENERIC_OK });
      }

      const token = generateVerificationToken();

      await User.create({
        name: cleanName,
        email: emailLower,
        password: await hashPassword(password),
        emailVerificationToken: token.hash,
        emailVerificationExpires: token.expires,
      });

      await sendVerificationEmail({
        to: emailLower,
        name: cleanName,
        verifyUrl: `${appBaseUrl()}/verify-email?token=${token.raw}`,
      });

      return res.status(201).json({ message: GENERIC_OK });
    } catch (error) {
      console.error('Registration error:', error);
      return res.status(500).json({ error: 'An error occurred during registration' });
    }
  };
}
