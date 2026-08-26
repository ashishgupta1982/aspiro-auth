import { randomUUID } from 'crypto';
import { serialize } from 'cookie';
import { MongoDBAdapter } from '@next-auth/mongodb-adapter';

// Mints a NextAuth *database* session directly through the adapter.
//
// Why this exists: this app uses database sessions (adapter-backed), and
// NextAuth's CredentialsProvider only supports JWT sessions — adopting it would
// force the whole app onto JWTs, log every existing user out, and break
// server-side session revocation. So first-party email + password login mints
// its own DB session here instead. Google and Apple continue to go through
// NextAuth untouched, and the resulting session is indistinguishable from
// theirs — withAuth and getServerSession need no changes.
//
// The Mongo client is passed in rather than imported: the package must not
// assume where an app keeps its adapter client.

const DEFAULT_SESSION_DAYS = 30;

/**
 * The session cookie name must match what NextAuth expects: the __Secure-
 * prefix is used on HTTPS (production) and not on local http.
 */
export function sessionCookieName() {
  return process.env.NODE_ENV === 'production'
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';
}

/**
 * Create a database session for a user and set the session cookie on the response.
 *
 * @param {{ clientPromise: Promise, userId: string, res: object, days?: number }} params
 * @returns {Promise<{ sessionToken: string, expires: Date }>}
 */
export async function createDbSession({ clientPromise, userId, res, days = DEFAULT_SESSION_DAYS }) {
  const adapter = MongoDBAdapter(clientPromise);
  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await adapter.createSession({ sessionToken, userId: String(userId), expires });

  const secure = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    serialize(sessionCookieName(), sessionToken, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires,
    })
  );

  return { sessionToken, expires };
}
