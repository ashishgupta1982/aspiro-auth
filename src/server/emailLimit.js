import { createHash } from 'crypto';

// A limit on emails to one address, on top of the app's per-IP limit. The IP
// limit alone let someone moving between networks fill a person's inbox with our
// verification, reset and account-exists emails, and spend the Resend allowance.
// Found in the 2026-11-23 sweep.
//
// Kept in Mongo, not in memory: each serverless instance has its own memory, so
// an in-memory count would reset whenever a request landed somewhere new. Only a
// hash of the address is stored, and Mongo removes each row after the window.
//
// Over the limit the email is simply not sent. The routes still give their usual
// answer, so the limit does not reveal whether an address has an account.

const COLLECTION = 'authemailsends';
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

let indexed = false;

export async function allowEmailTo(clientPromise, address) {
  try {
    const client = await clientPromise;
    const col = client.db().collection(COLLECTION);
    if (!indexed) {
      // Mongo reaps expired rows itself. Creating an existing index is a no-op.
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
      indexed = true;
    }
    const key = createHash('sha256').update(String(address).toLowerCase().trim()).digest('base64url');
    const now = Date.now();
    const recent = await col.countDocuments({ key, at: { $gt: new Date(now - WINDOW_MS) } });
    if (recent >= MAX_PER_WINDOW) {
      console.warn('[aspiro-auth] email limit reached for an address; not sending');
      return false;
    }
    await col.insertOne({ key, at: new Date(now), expiresAt: new Date(now + WINDOW_MS) });
    return true;
  } catch (error) {
    // A failure here must not stop a sign-up; the per-IP limit still applies.
    console.error('[aspiro-auth] email limit check failed:', error?.message || error);
    return true;
  }
}
