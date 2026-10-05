import { describe, it, expect, afterEach } from 'vitest';
import {
  encryptToken,
  decryptToken,
  encryptWithPassword,
  decryptWithPassword,
  getStorageKey,
  validateProductionSecrets,
} from './crypto.ts';

describe('Auth Crypto Module (AES-256-GCM & PBKDF2)', () => {
  it('derives a consistent 32-byte key', () => {
    const key1 = getStorageKey('custom-secret');
    const key2 = getStorageKey('custom-secret');
    expect(key1).toHaveLength(32);
    expect(key1.equals(key2)).toBe(true);
  });

  it('encrypts and decrypts tokens successfully with AES-256-GCM', () => {
    const rawToken = 'CCP_REFRESH_TOKEN_mock_secret_abcdef123456';
    const encrypted = encryptToken(rawToken);

    // Format check: iv:tag:data
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // 12 bytes hex
    expect(parts[1]).toHaveLength(32); // 16 bytes auth tag hex
    expect(parts[2].length).toBeGreaterThan(0);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('detects tampered ciphertext and throws an error on GCM tag verification failure', () => {
    const rawToken = 'secret-token-to-tamper';
    const encrypted = encryptToken(rawToken);
    const [iv, tag, data] = encrypted.split(':');

    // Tamper with data
    const tamperedData = (data[0] === 'a' ? 'b' : 'a') + data.slice(1);
    const tamperedPayload = `${iv}:${tag}:${tamperedData}`;

    expect(() => decryptToken(tamperedPayload)).toThrow(/Failed to decrypt token/);
  });

  it('encrypts and decrypts with password for fleet backup export/import', () => {
    const fleetJson = JSON.stringify([
      { characterId: 1001, characterName: 'Char One', refreshToken: 'tok-1' },
      { characterId: 1002, characterName: 'Char Two', refreshToken: 'tok-2' },
    ]);

    const password = 'SuperSecurePassword2026!';
    const encryptedBackup = encryptWithPassword(fleetJson, password);

    // Format: salt:iv:tag:data
    const parts = encryptedBackup.split(':');
    expect(parts).toHaveLength(4);

    const decryptedJson = decryptWithPassword(encryptedBackup, password);
    expect(decryptedJson).toBe(fleetJson);
  });

  it('rejects wrong password when decrypting fleet backup', () => {
    const payload = 'sensitive fleet data';
    const encryptedBackup = encryptWithPassword(payload, 'RightPassword');

    expect(() => decryptWithPassword(encryptedBackup, 'WrongPassword')).toThrow(
      'Mot de passe incorrect ou sauvegarde corrompue'
    );
  });

  describe('Phase G01 — Production Fail-Fast & Secret Validation', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalKey = process.env.SESSION_ENCRYPTION_KEY;
    const originalSecret = process.env.SESSION_SECRET;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      if (originalKey !== undefined) {
        process.env.SESSION_ENCRYPTION_KEY = originalKey;
      } else {
        delete process.env.SESSION_ENCRYPTION_KEY;
      }
      if (originalSecret !== undefined) {
        process.env.SESSION_SECRET = originalSecret;
      } else {
        delete process.env.SESSION_SECRET;
      }
    });

    it('TEST-G01-01: throws fatal error in production when SESSION_ENCRYPTION_KEY is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SESSION_ENCRYPTION_KEY;
      delete process.env.SESSION_SECRET;

      expect(() => validateProductionSecrets()).toThrow(
        /SESSION_ENCRYPTION_KEY.*strictly required in production/
      );
      expect(() => getStorageKey()).toThrow(
        /SESSION_ENCRYPTION_KEY is strictly required in production/
      );
    });

    it('TEST-G01-02: throws fatal error in production when SESSION_ENCRYPTION_KEY is too short (< 32 chars)', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_ENCRYPTION_KEY = 'short-weak-key-123';

      expect(() => validateProductionSecrets()).toThrow(
        /minimum 32 characters/
      );
    });

    it('TEST-G01-03: accepts valid 256-bit encryption key in production and derives 32-byte hash', () => {
      process.env.NODE_ENV = 'production';
      process.env.SESSION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      expect(() => validateProductionSecrets()).not.toThrow();
      const key = getStorageKey();
      expect(key).toHaveLength(32);
    });
  });
});
