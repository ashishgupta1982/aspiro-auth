import { generateVerificationToken } from '../verificationToken.js';
import { sendVerificationEmail, appBaseUrl } from '../email.js';

// Re-issues a verification link. Enumeration-safe: the response never reveals
// whether the address exists or is already verified.

const GENERIC_OK = 'If that address needs verifying, a new link is on its way.';

export function createResendVerificationHandler(ctx) {
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
      const { email } = req.body || {};
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      await dbConnect();
      const emailLower = String(email).toLowerCase().trim();
      const user = await User.findOne({ email: emailLower }).select('+password name emailVerified');

      // Only re-send for an unverified account that actually has a password.
      // A Google/Apple-only account has nothing to verify.
      if (user && !user.emailVerified && user.password) {
        const token = generateVerificationToken();
        user.emailVerificationToken = token.hash;
        user.emailVerificationExpires = token.expires;
        await user.save();

        await sendVerificationEmail({
          to: emailLower,
          name: user.name,
          verifyUrl: `${appBaseUrl()}/verify-email?token=${token.raw}`,
        });
      }

      return res.status(200).json({ message: GENERIC_OK });
    } catch (error) {
      console.error('Resend verification error:', error);
      return res.status(500).json({ error: 'An error occurred sending the verification email' });
    }
  };
}
