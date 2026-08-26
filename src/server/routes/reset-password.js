import { ObjectId } from 'mongodb';
import { hashToken } from '../verificationToken.js';
import { hashPassword, validatePassword } from '../password.js';
import { createDbSession } from '../session.js';

// Consumes a password-reset link and sets the new password.
//
// Completing this proves control of the mailbox, so it also marks the address
// verified — which is what lets an OAuth-only account gain a password, and what
// lets a user who never clicked their original verification link recover.
//
// Every other session for the account is destroyed: if the reset was triggered
// because someone else had access, finishing it must lock them out.

export function createResetPasswordHandler(ctx) {
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
      const { token, password } = req.body || {};
      if (!token) {
        return res.status(400).json({ error: 'This reset link is invalid.' });
      }

      const strength = validatePassword(password);
      if (!strength.ok) {
        return res.status(400).json({ error: strength.error });
      }

      await dbConnect();

      const user = await User.findOne({
        passwordResetToken: hashToken(String(token)),
        passwordResetExpires: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({
          error: 'This reset link is invalid or has expired. Request a new one.',
          code: 'invalid_token',
        });
      }

      user.password = await hashPassword(password);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      // Reaching this link proves the mailbox is theirs.
      if (!user.emailVerified) user.emailVerified = new Date();
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      user.lastLoginAt = new Date();
      await user.save();

      // Revoke every existing session for this user. The adapter stores userId as
      // an ObjectId; older rows may hold a string, so clear both shapes.
      const client = await clientPromise;
      const idString = user._id.toString();
      await client.db().collection('sessions').deleteMany({
        $or: [{ userId: new ObjectId(idString) }, { userId: idString }],
      });

      // Then sign them in on this device only.
      await createDbSession({ clientPromise, userId: idString, res });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Reset password error:', error);
      return res.status(500).json({ error: 'An error occurred resetting your password' });
    }
  };
}
