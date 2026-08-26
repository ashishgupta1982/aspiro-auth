import { generatePasswordResetToken } from '../verificationToken.js';
import { sendPasswordResetEmail, appBaseUrl } from '../email.js';

// Starts a password reset. Enumeration-safe — the response is identical whether
// or not the address has an account.
//
// This is also the supported way to ADD a password to an account that currently
// signs in with Google or Apple only: it requires control of the mailbox, which
// is exactly the proof that registration deliberately refuses to accept.

const GENERIC_OK = "If that address has an account, a reset link is on its way.";

export function createForgotPasswordHandler(ctx) {
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
      const user = await User.findOne({ email: emailLower }).select('name');

      if (user) {
        const token = generatePasswordResetToken();
        user.passwordResetToken = token.hash;
        user.passwordResetExpires = token.expires;
        await user.save();

        await sendPasswordResetEmail({
          to: emailLower,
          name: user.name,
          resetUrl: `${appBaseUrl()}/reset-password?token=${token.raw}`,
        });
      }

      return res.status(200).json({ message: GENERIC_OK });
    } catch (error) {
      console.error('Forgot password error:', error);
      return res.status(500).json({ error: 'An error occurred starting the password reset' });
    }
  };
}
