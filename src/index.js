import { configureBrand } from './server/email.js';
import { buildAuthOptions } from './server/nextauth.js';
import { createLoginHandler } from './server/routes/login.js';
import { createRegisterHandler } from './server/routes/register.js';
import { createVerifyEmailHandler } from './server/routes/verify-email.js';
import { createForgotPasswordHandler } from './server/routes/forgot-password.js';
import { createResetPasswordHandler } from './server/routes/reset-password.js';
import { createResendVerificationHandler } from './server/routes/resend-verification.js';
import {
  assertScheme, createNativeStartHandler, createNativeFinishHandler, createNativeRedeemHandler,
} from './server/native.js';

export { authFields } from './model/authFields.js';
export { createDbSession, sessionCookieName } from './server/session.js';
export { MIN_PASSWORD_LENGTH } from './server/password.js';

/**
 * Build an app's complete auth surface from one config object.
 *
 * Google, Apple and email + password are FIXED — every app gets all three. Apple
 * registers itself only when its four env vars are present, so an app without
 * Apple credentials simply doesn't offer the button. There is no capability
 * selection and therefore no combination logic: the rules binding the providers
 * together are always wired.
 *
 * @param {object} config
 * @param {{name: string, colour: string, url: string, verifyNote?: string}} config.brand
 * @param {{User: object}} config.models
 * @param {Function} config.dbConnect          the app's mongoose connect helper
 * @param {Promise}  config.clientPromise      the app's raw Mongo client (adapter)
 * @param {{checkRate: Function, getClientIP: Function}} config.rateLimit
 * @param {boolean}  [config.requireName]      hard-fail registration without a name
 * @param {Function} [config.onSession]        add per-app session fields
 * @param {Function} [config.onSignIn]         extra work on a PROVIDER sign-in
 * @param {object}   [config.pages]            override NextAuth page routes
 * @param {{scheme: string}} [config.native]   the iOS shell's URL scheme (the bundle
 *   id): turns on Google and Apple sign-in inside the shell (server/native.js)
 */
export function createAuth(config) {
  const {
    brand, models, dbConnect, clientPromise, rateLimit,
    requireName = false, onSession, onSignIn, pages, native,
  } = config;

  // Fail loudly at import time rather than at the first sign-in attempt.
  if (!brand?.name) throw new Error('[aspiro-auth] config.brand.name is required');
  if (!models?.User) throw new Error('[aspiro-auth] config.models.User is required');
  if (!dbConnect) throw new Error('[aspiro-auth] config.dbConnect is required');
  if (!clientPromise) throw new Error('[aspiro-auth] config.clientPromise is required');
  if (!rateLimit?.checkRate || !rateLimit?.getClientIP) {
    throw new Error('[aspiro-auth] config.rateLimit needs { checkRate, getClientIP }');
  }
  if (native) assertScheme(native.scheme);

  // `verifyNote` is optional and app-specific: one sentence appended to the
  // verification email saying what the user does next in THIS app.
  configureBrand({
    name: brand.name,
    colour: brand.colour,
    fallbackUrl: brand.url,
    verifyNote: brand.verifyNote || '',
  });

  const ctx = {
    dbConnect,
    User: models.User,
    clientPromise,
    checkRate: rateLimit.checkRate,
    getClientIP: rateLimit.getClientIP,
    requireName,
  };

  return {
    authOptions: buildAuthOptions({ dbConnect, User: models.User, clientPromise, onSession, onSignIn, pages }),
    login: createLoginHandler(ctx),
    register: createRegisterHandler(ctx),
    verifyEmail: createVerifyEmailHandler(ctx),
    forgotPassword: createForgotPasswordHandler(ctx),
    resetPassword: createResetPasswordHandler(ctx),
    resendVerification: createResendVerificationHandler(ctx),

    // The iOS shell's sign-in hand-over. Without `native` there is no shell to
    // hand over to, so the routes answer 404 rather than half-work.
    nativeStart: native
      ? createNativeStartHandler({ brandName: brand.name })
      : notConfigured,
    nativeFinish: native
      ? createNativeFinishHandler({ clientPromise, scheme: native.scheme })
      : notConfigured,
    nativeRedeem: native
      ? createNativeRedeemHandler({ clientPromise, checkRate: rateLimit.checkRate, getClientIP: rateLimit.getClientIP })
      : notConfigured,
  };
}

function notConfigured(req, res) {
  return res.status(404).json({ error: 'Not found' });
}
