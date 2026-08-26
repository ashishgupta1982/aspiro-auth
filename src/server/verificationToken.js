// Extracted verbatim from ChessMaster on 2026-08-26, which was the canonical
// copy: newest implementation, and the only one passing all seven checks in
// the vault's Indie-Dev/Auth audit. Nothing here is app-specific.

import crypto from 'crypto';

// Token helpers for email verification and password reset.
//
// The RAW token is what goes in the emailed link; only its SHA-256 HASH is ever
// stored on the User, so a database leak can't be replayed to verify an address
// or reset a password. Every route that mints or checks a token goes through
// here so they can never disagree on the hashing.

const VERIFY_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const RESET_EXPIRY_MS = 60 * 60 * 1000;       // 1 hour — shorter; it's a stronger capability

export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function generate(expiryMs) {
  const raw = crypto.randomBytes(32).toString('hex');
  return {
    raw,
    hash: hashToken(raw),
    expires: new Date(Date.now() + expiryMs),
  };
}

export function generateVerificationToken() {
  return generate(VERIFY_EXPIRY_MS);
}

export function generatePasswordResetToken() {
  return generate(RESET_EXPIRY_MS);
}

/**
 * Timing-safe comparison of two hex hashes.
 */
export function tokenMatches(rawFromLink, storedHash) {
  if (!rawFromLink || !storedHash) return false;
  const a = Buffer.from(hashToken(rawFromLink), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
