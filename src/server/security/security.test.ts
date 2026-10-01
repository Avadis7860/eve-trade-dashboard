// @vitest-environment node
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { Request, Response, Express } from 'express';
import request from 'supertest';
import { defaultSessionStore } from '../auth/sessionStore.ts';
import { DEFAULT_SCOPES } from '../auth/service.ts';
import { sanitizeLogMessage } from '../utils/logger.ts';
import { validateCharacterSessionAccess, securityHeadersMiddleware, csrfProtectionMiddleware } from '../middleware/security.ts';
import type { UserSession } from '../auth/types.ts';
import { createApp } from '../../../server.ts';
import { defaultBackupService } from '../storage/backupService.ts';

describe('PHASE-H01 — Security Hardening Test Suite', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    defaultSessionStore.clearAll();
  });

  describe('1. Security Headers & CSP Enforcement', () => {
    it('sets strict CSP, nosniff, frame-options, referrer-policy and disables x-powered-by', () => {
      const mockReq = {
        secure: false,
        headers: {},
      } as unknown as Request;

      const headersSet: Record<string, string> = {};
      const headersRemoved: string[] = [];

      const mockRes = {
        setHeader: (key: string, val: string) => {
          headersSet[key.toLowerCase()] = val;
        },
        removeHeader: (key: string) => {
          headersRemoved.push(key.toLowerCase());
        },
      } as unknown as Response;

      const next = () => {};

      securityHeadersMiddleware(mockReq, mockRes, next);

      expect(headersRemoved).toContain('x-powered-by');
      expect(headersSet['x-content-type-options']).toBe('nosniff');
      expect(headersSet['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(headersSet['permissions-policy']).toBeDefined();
      expect(headersSet['content-security-policy']).toBeDefined();
      expect(headersSet['content-security-policy']).toContain("default-src 'self'");
      expect(headersSet['content-security-policy']).toContain('https://images.evetech.net');
      expect(headersSet['content-security-policy']).toContain('https://esi.evetech.net');
      expect(headersSet['content-security-policy']).toContain('frame-ancestors');
    });

    it('sets Strict-Transport-Security when HTTPS is detected', () => {
      const mockReq = {
        secure: true,
        headers: { 'x-forwarded-proto': 'https' },
      } as unknown as Request;

      const headersSet: Record<string, string> = {};
      const mockRes = {
        setHeader: (key: string, val: string) => {
          headersSet[key.toLowerCase()] = val;
        },
        removeHeader: () => {},
      } as unknown as Response;

      securityHeadersMiddleware(mockReq, mockRes, () => {});
      expect(headersSet['strict-transport-security']).toContain('max-age=31536000');
    });
  });

  describe('2. CSRF Protection for Mutating HTTP Methods', () => {
    it('passes GET requests without CSRF check', () => {
      let nextCalled = false;
      const mockReq = {
        method: 'GET',
        headers: {},
        path: '/api/ledger/summary',
      } as unknown as Request;

      const mockRes = {} as unknown as Response;
      csrfProtectionMiddleware(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });

    it('rejects POST request from untrusted origin without CSRF headers', () => {
      let statusCode = 0;
      let errorBody = {};

      const mockReq = {
        method: 'POST',
        headers: {
          origin: 'https://evil-hacker-site.com',
          host: 'localhost:3000',
        },
        path: '/api/roi/reconcile',
      } as unknown as Request;

      const mockRes = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (data: unknown) => {
              errorBody = data as Record<string, unknown>;
            },
          };
        },
      } as unknown as Response;

      csrfProtectionMiddleware(mockReq, mockRes, () => {});

      expect(statusCode).toBe(403);
      expect((errorBody as { error: string }).error).toContain('CSRF');
    });

    it('allows POST request from trusted origin or with custom header', () => {
      let nextCalled = false;
      const mockReq = {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
        path: '/api/roi/reconcile',
      } as unknown as Request;

      const mockRes = {} as unknown as Response;
      csrfProtectionMiddleware(mockReq, mockRes, () => {
        nextCalled = true;
      });

      expect(nextCalled).toBe(true);
    });
  });

  describe('3. Character Isolation & Unauthorized Access Prevention', () => {
    const session: UserSession = {
      sessionId: 'test_session_123',
      characterId: 10001,
      activeCharacterId: 10001,
      characterName: 'Authorized Trader 1',
      scopes: DEFAULT_SCOPES,
      accessToken: 'acc_1',
      refreshToken: 'ref_1',
      expiresAt: Date.now() + 3600000,
      createdAt: Date.now(),
      characters: {
        10001: {
          characterId: 10001,
          characterName: 'Authorized Trader 1',
          scopes: DEFAULT_SCOPES,
          accessToken: 'acc_1',
          refreshToken: 'ref_1',
          expiresAt: Date.now() + 3600000,
          createdAt: Date.now(),
        },
        10002: {
          characterId: 10002,
          characterName: 'Authorized Trader 2',
          scopes: DEFAULT_SCOPES,
          accessToken: 'acc_2',
          refreshToken: 'ref_2',
          expiresAt: Date.now() + 3600000,
          createdAt: Date.now(),
        },
      },
    };

    it('allows access to characters belonging to the session', () => {
      const access1 = validateCharacterSessionAccess(session, 10001);
      expect(access1.allowed).toBe(true);

      const access2 = validateCharacterSessionAccess(session, [10001, 10002]);
      expect(access2.allowed).toBe(true);
    });

    it('strictly denies access to characters outside the session (multi-tenant isolation)', () => {
      const forbiddenAccess = validateCharacterSessionAccess(session, 99999);
      expect(forbiddenAccess.allowed).toBe(false);
      expect(forbiddenAccess.unauthorizedIds).toContain(99999);

      const mixedAccess = validateCharacterSessionAccess(session, [10001, 99999]);
      expect(mixedAccess.allowed).toBe(false);
      expect(mixedAccess.unauthorizedIds).toEqual([99999]);
    });
  });

  describe('4. ESI Scopes Minimization & CCP Policies Compliance', () => {
    it('requests ONLY read-only scopes and no write/order modification scopes', () => {
      for (const scope of DEFAULT_SCOPES) {
        expect(scope).toMatch(/^esi-[a-z_]+\.read_[a-z_]+\.v[0-9]+$/);
        expect(scope).not.toContain('write');
        expect(scope).not.toContain('modify');
        expect(scope).not.toContain('structure_markets');
      }
    });
  });

  describe('5. Sensitive Data Redaction & Log Sanitization', () => {
    it('redacts Authorization bearer tokens, refresh tokens, client secrets, and session cookies', () => {
      const log1 = 'Request failed with header: Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.token123';
      const sanitized1 = sanitizeLogMessage(log1);
      expect(sanitized1).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.token123');
      expect(sanitized1).toContain('[REDACTED]');

      const log2 = 'OAuth error with refresh_token=secret_refresh_token_987 and client_secret="my_super_secret"';
      const sanitized2 = sanitizeLogMessage(log2);
      expect(sanitized2).not.toContain('secret_refresh_token_987');
      expect(sanitized2).not.toContain('my_super_secret');
      expect(sanitized2).toContain('[REDACTED]');

      const log3 = 'Cookie present: eve_session_id=abcd1234efgh5678ijkl';
      const sanitized3 = sanitizeLogMessage(log3);
      expect(sanitized3).not.toContain('abcd1234efgh5678ijkl');
      expect(sanitized3).toContain('[REDACTED]');
    });
  });

  describe('6. Logout & Session Data Purge', () => {
    it('completely invalidates session on logout and purges state', () => {
      const session = defaultSessionStore.createSession({
        characterId: 77777,
        characterName: 'Secret Pilot',
        scopes: DEFAULT_SCOPES,
        accessToken: 'access_secret',
        refreshToken: 'refresh_secret',
        expiresAt: Date.now() + 3600000,
      });

      expect(defaultSessionStore.getSession(session.sessionId)).not.toBeNull();

      const deleted = defaultSessionStore.deleteSession(session.sessionId);
      expect(deleted).toBe(true);
      expect(defaultSessionStore.getSession(session.sessionId)).toBeNull();
    });
  });

  describe('7. Phase R06 — HTTP Multi-Tenant Route Isolation & Secret Non-Exposition', () => {
    let app: Express;
    let sessionA: UserSession;

    beforeAll(async () => {
      app = await createApp();
    });

    beforeEach(() => {
      defaultSessionStore.clearAll();
      sessionA = defaultSessionStore.createSession({
        characterId: 10001,
        characterName: 'Character A',
        scopes: DEFAULT_SCOPES,
        accessToken: 'access_token_pilot_a',
        refreshToken: 'refresh_token_pilot_a',
        expiresAt: Date.now() + 3600000,
      });
    });

    it('rejects access to Character B data with HTTP 403 Forbidden when authenticated as Character A (/api/ledger/transactions?characterId=9999)', async () => {
      const res = await request(app)
        .get('/api/ledger/transactions?characterId=9999')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Accès refusé');
    });

    it('rejects access to Character B data on orders, assets, capital, and roi endpoints with HTTP 403 Forbidden', async () => {
      const resOrders = await request(app)
        .get('/api/orders?characterId=9999')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`);
      expect(resOrders.status).toBe(403);

      const resAssets = await request(app)
        .get('/api/assets?character_id=9999')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`);
      expect(resAssets.status).toBe(403);

      const resCapital = await request(app)
        .get('/api/capital/summary?character_id=9999')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`);
      expect(resCapital.status).toBe(403);

      const resRoi = await request(app)
        .get('/api/roi/summary?character_id=9999')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`);
      expect(resRoi.status).toBe(403);
    });

    it('rejects restoring a backup with unauthorized character data with HTTP 403 Forbidden', async () => {
      // Create backup containing data for character 9999 (not in sessionA)
      const unauthorizedBackup = defaultBackupService.exportBackup();
      unauthorizedBackup.data.ledger.transactions.push({
        id: '9999:1',
        characterId: 9999,
        transactionId: 1,
        date: '2026-09-01T10:00:00Z',
        typeId: 34,
        quantity: 10,
        unitPrice: 5.0,
        totalValue: 50,
        isBuy: true,
        isPersonal: true,
        journalRefId: 1,
        locationId: 60003760,
        clientId: 9999,
        source: 'test',
        observedAt: Date.now(),
      });
      unauthorizedBackup.checksum = defaultBackupService.computeChecksum(unauthorizedBackup.data);

      const res = await request(app)
        .post('/api/backup/restore')
        .set('Cookie', `eve_session_id=${sessionA.sessionId}`)
        .send(unauthorizedBackup);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('non autorisés');
    });

    it('ensures logs never expose secrets even when capturing ESI network errors and error objects', () => {
      const networkError = new Error('ESI request failed (500) for https://esi.evetech.net/v1/characters/10001/orders/?token=secret_esi_token_abc');
      networkError.stack = `Error: ESI network failed
        at fetch (https://esi.evetech.net/v1/?access_token=secret_access_xyz)
        with Header Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.token_payload
        and code_verifier="secret_pkce_verifier_999"`;

      const sanitized = sanitizeLogMessage(networkError);

      expect(sanitized).not.toContain('secret_esi_token_abc');
      expect(sanitized).not.toContain('secret_access_xyz');
      expect(sanitized).not.toContain('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.token_payload');
      expect(sanitized).not.toContain('secret_pkce_verifier_999');
      expect(sanitized).toContain('[REDACTED]');
    });
  });
});
