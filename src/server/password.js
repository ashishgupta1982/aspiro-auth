// Extracted verbatim from ChessMaster on 2026-08-26, which was the canonical
// copy: newest implementation, and the only one passing all seven checks in
// the vault's Indie-Dev/Auth audit. Nothing here is app-specific.

import bcrypt from 'bcryptjs';

// Password hashing + strength rules, in one place so register / reset / login
// can never disagree about the cost factor or the minimum length.

export const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_COST = 12;

/**
 * @param {string} password
 * @returns {{ ok: boolean, error?: string }}
 */
export function validatePassword(password) {
  if (typeof password !== 'string' || !password) {
    return { ok: false, error: 'Password is required' };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (password.length > 200) {
    // bcrypt silently truncates past 72 bytes; reject absurd input rather than
    // hashing megabytes of it.
    return { ok: false, error: 'Password is too long' };
  }
  return { ok: true };
}

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Constant-ish time compare. Always pass a hash — when the user doesn't exist,
 * call this with a dummy hash so the response time doesn't reveal that.
 */
export function verifyPassword(password, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(password, hash);
}

// A real bcrypt hash of a random string, used to burn the same CPU time on a
// missing-user login as on a wrong-password login (blocks user enumeration by
// timing).
export const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1u7qYq6cPMB4Vu2gGqQ0Sm0k7q1sHpS';
