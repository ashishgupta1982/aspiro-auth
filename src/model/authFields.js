// The User schema fields email + password auth needs.
//
// Spread into an app's own User schema rather than owning the model — every app
// has its own extra fields, and a shared model would be a fork magnet.
//
// Everything secret is `select: false` so it can never ride along on an ordinary
// query; the routes that need it ask with .select('+password') explicitly.
// `emailVerified` is deliberately NOT select:false — the NextAuth adapter writes
// and reads that field itself.
export const authFields = {
  password: {
    type: String,
    select: false,
  },
  emailVerified: {
    type: Date,
  },
  emailVerificationToken: {
    type: String,
    select: false,
  },
  emailVerificationExpires: {
    type: Date,
    select: false,
  },
  passwordResetToken: {
    type: String,
    select: false,
  },
  passwordResetExpires: {
    type: Date,
    select: false,
  },
};
