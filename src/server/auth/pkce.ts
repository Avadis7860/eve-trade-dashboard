import crypto from 'node:crypto';

/**
 * Base64 URL-safe encoding without padding (RFC 7636)
 */
export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generates a high-entropy PKCE code_verifier (32 random bytes -> 43 base64url chars)
 */
export function generateCodeVerifier(): string {
  const randomBytes = crypto.randomBytes(32);
  return base64UrlEncode(randomBytes);
}

/**
 * Computes S256 code_challenge from code_verifier
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generates a secure random state string for OAuth CSRF protection
 */
export function generateState(): string {
  return crypto.randomBytes(24).toString('hex');
}
