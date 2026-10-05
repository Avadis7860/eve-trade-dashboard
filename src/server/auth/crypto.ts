import crypto from 'node:crypto';

/**
 * Validates that cryptographic secrets are strictly configured in production.
 * Throws a fatal error if missing or too weak.
 */
export function validateProductionSecrets(): void {
  if (process.env.NODE_ENV === 'production') {
    const key = process.env.SESSION_ENCRYPTION_KEY || process.env.SESSION_SECRET;
    if (!key || key.trim().length < 32) {
      throw new Error('FATAL: SESSION_ENCRYPTION_KEY (minimum 32 characters / 256-bit) is strictly required in production environment');
    }
  }
}

/**
 * Derives a consistent 32-byte AES-256 key from a secret string or environment variable.
 */
export function getStorageKey(providedKey?: string): Buffer {
  if (providedKey) {
    return crypto.createHash('sha256').update(providedKey).digest();
  }
  const secret = process.env.SESSION_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: SESSION_ENCRYPTION_KEY is strictly required in production environment');
    }
    return crypto.createHash('sha256').update('eve-trade-dashboard-session-master-secret-key-32b').digest();
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a sensitive string (token) using AES-256-GCM.
 * Output format: hex(iv):hex(tag):hex(ciphertext)
 */
export function encryptToken(plainText: string, key?: string): string {
  if (!plainText) return '';
  const keyBuffer = getStorageKey(key);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a payload encrypted with encryptToken.
 * Returns the decrypted string, or returns the input if not encrypted/legacy.
 */
export function decryptToken(encryptedPayload: string, key?: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    // Not in iv:tag:data format, return as is (fallback for legacy or unencrypted data)
    return encryptedPayload;
  }
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const keyBuffer = getStorageKey(key);
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new Error(`Failed to decrypt token: ${(err as Error).message}`);
  }
}

/**
 * Encrypts arbitrary text or JSON with a user-supplied password using PBKDF2 + AES-256-GCM.
 * Output format: hex(salt):hex(iv):hex(tag):hex(ciphertext)
 */
export function encryptWithPassword(plainText: string, password: string): string {
  if (!password || password.trim().length === 0) {
    throw new Error('Un mot de passe est obligatoire pour chiffrer la sauvegarde');
  }
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts arbitrary payload encrypted with encryptWithPassword.
 * Throws explicit error if password is incorrect or data corrupted.
 */
export function decryptWithPassword(encryptedPayload: string, password: string): string {
  if (!password || password.trim().length === 0) {
    throw new Error('Mot de passe requis');
  }
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4) {
    throw new Error('Format de sauvegarde de trousseau invalide ou corrompu');
  }
  const [saltHex, ivHex, tagHex, dataHex] = parts;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Mot de passe incorrect ou sauvegarde corrompue');
  }
}
