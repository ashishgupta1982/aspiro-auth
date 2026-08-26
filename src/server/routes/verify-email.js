import { hashToken } from '../verificationToken.js';
import { createDbSession } from '../session.js';

// Consumes the emailed verification link. On success the address is marked
// verified, the token is destroyed (single use), and the user is signed straight
// in — they've just proved control of the mailbox, so making them type the
// password again adds nothing.

export function createVerifyEmailHandler(ctx) {
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
      const { token } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: 'This verification link is invalid.' });
      }

      await dbConnect();

      // Look up by the stored HASH — the raw token only ever exists in the link.
      const user = await User.findOne({
        emailVerificationToken: hashToken(String(token)),
        emailVerificationExpires: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({
          error: 'This verification link is invalid or has expired. Request a new one below.',
          code: 'invalid_token',
        });
      }

      user.emailVerified = new Date();
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      user.lastLoginAt = new Date();
      await user.save();

      await createDbSession({ clientPromise, userId: user._id.toString(), res });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Email verification error:', error);
      return res.status(500).json({ error: 'An error occurred verifying your email' });
    }
  };
}
