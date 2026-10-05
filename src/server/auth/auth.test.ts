// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.ts';
import { extractAndValidateCharacterIdentity } from './jwt.ts';
import { SessionStore } from './sessionStore.ts';

import { AuthService, DEFAULT_SCOPES } from './service.ts';
import { createAuthRouter } from './router.ts';
import type { EveTokenResponse } from './types.ts';

// Helper to create a test JWT token
function createMockJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = Buffer.from('mock_signature').toString('base64url');
  return `${header}.${body}.${sig}`;
}

describe('Auth Module — PKCE & Cryptography', () => {
  it('generates high entropy code verifiers and valid S256 code challenge', () => {
    const verifier1 = generateCodeVerifier();
    const verifier2 = generateCodeVerifier();

    expect(verifier1).not.toBe(verifier2);
    expect(verifier1.length).toBeGreaterThanOrEqual(43);

    const challenge = generateCodeChallenge(verifier1);
    expect(challenge).toBeDefined();
    expect(challenge.length).toBeGreaterThanOrEqual(43);
    // Deterministic for same verifier
    expect(generateCodeChallenge(verifier1)).toBe(challenge);
  });

  it('generates unique CSRF states', () => {
    const state1 = generateState();
    const state2 = generateState();
    expect(state1).not.toBe(state2);
    expect(state1.length).toBe(48); // 24 hex bytes
  });
});

describe('Auth Module — JWT Claims & Validation', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 1200;

  it('correctly extracts and validates valid CCP SSO token claims', () => {
    const validToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:2119876543',
      name: 'Pilot Maverick',
      owner: 'hash_abc123',
      scp: ['esi-wallet.read_character_wallet.v1', 'esi-markets.read_character_orders.v1'],
      exp: futureExp,
      azp: 'test_client_id',
    });

    const identity = extractAndValidateCharacterIdentity(validToken, 'test_client_id');
    expect(identity.characterId).toBe(2119876543);
    expect(identity.characterName).toBe('Pilot Maverick');
    expect(identity.ownerHash).toBe('hash_abc123');
    expect(identity.scopes).toContain('esi-wallet.read_character_wallet.v1');
    expect(identity.scopes).toContain('esi-markets.read_character_orders.v1');
  });

  it('rejects expired tokens', () => {
    const expiredToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:2119876543',
      name: 'Pilot Maverick',
      exp: Math.floor(Date.now() / 1000) - 3600, // 1 hr ago
    });

    expect(() => extractAndValidateCharacterIdentity(expiredToken)).toThrow(/expired/i);
  });

  it('rejects invalid issuer', () => {
    const forgedToken = createMockJwt({
      iss: 'malicious-issuer.com',
      sub: 'CHARACTER:EVE:2119876543',
      name: 'Fake Pilot',
      exp: futureExp,
    });

    expect(() => extractAndValidateCharacterIdentity(forgedToken)).toThrow(/issuer/i);
  });

  it('rejects invalid character subject format', () => {
    const invalidSubToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'USER:123',
      name: 'Pilot',
      exp: futureExp,
    });

    expect(() => extractAndValidateCharacterIdentity(invalidSubToken)).toThrow(/subject/i);
  });

  it('rejects client ID / azp mismatch', () => {
    const mismatchToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:2119876543',
      name: 'Pilot',
      azp: 'other_client_id',
      exp: futureExp,
    });

    expect(() => extractAndValidateCharacterIdentity(mismatchToken, 'my_client_id')).toThrow(/mismatch/i);
  });
});

describe('Auth Module — Session Store & CSRF Replay Protection', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  it('saves and consumes OAuth state exactly once (replay prevention)', () => {
    const state = 'test_state_123';
    const verifier = 'test_verifier_456';
    const sessionId = 'session_abc';

    store.saveOAuthState(state, verifier, sessionId);

    // First consumption succeeds
    const consumed = store.consumeOAuthState(state);
    expect(consumed?.verifier).toBe(verifier);
    expect(consumed?.sessionId).toBe(sessionId);

    // Second consumption fails (state consumed)
    const replayed = store.consumeOAuthState(state);
    expect(replayed).toBeNull();
  });

  it('creates, retrieves, updates and deletes user sessions', () => {
    const session = store.createSession({
      characterId: 99999,
      characterName: 'Trader John',
      scopes: ['esi-wallet.read_character_wallet.v1'],
      accessToken: 'access_1',
      refreshToken: 'refresh_1',
      expiresAt: Date.now() + 3600000,
    });

    expect(session.sessionId).toBeDefined();

    const fetched = store.getSession(session.sessionId);
    expect(fetched?.characterName).toBe('Trader John');

    // Update tokens
    store.updateSessionTokens(session.sessionId, 'access_2', 'refresh_2', Date.now() + 7200000);
    const updated = store.getSession(session.sessionId);
    expect(updated?.accessToken).toBe('access_2');

    // Delete session
    const deleted = store.deleteSession(session.sessionId);
    expect(deleted).toBe(true);
    expect(store.getSession(session.sessionId)).toBeNull();
  });
});

describe('Auth Module — AuthService SSO Flow', () => {
  let store: SessionStore;
  let authService: AuthService;
  const futureExp = Math.floor(Date.now() / 1000) + 1200;

  beforeEach(() => {
    store = new SessionStore();
  });

  it('generates login url containing required scopes, pkce challenge and state', () => {
    authService = new AuthService({
      clientId: 'my_eve_client_id',
      clientSecret: 'my_eve_client_secret',
      callbackUrl: 'http://localhost:3000/api/auth/callback',
      scopes: DEFAULT_SCOPES,
    }, store);

    const { url, state } = authService.createLoginUrl();
    expect(url).toContain('https://login.eveonline.com/v2/oauth/authorize');
    expect(url).toContain('client_id=my_eve_client_id');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain(`state=${state}`);
  });

  it('handles complete callback with code exchange, token decoding and session creation', async () => {
    const mockToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:12345678',
      name: 'Major Trader',
      scp: DEFAULT_SCOPES,
      exp: futureExp,
      azp: 'my_client',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<EveTokenResponse> => ({
        access_token: mockToken,
        token_type: 'Bearer',
        expires_in: 1200,
        refresh_token: 'valid_refresh_token',
      }),
    });

    authService = new AuthService({
      clientId: 'my_client',
      clientSecret: 'my_secret',
      callbackUrl: 'http://localhost:3000/api/auth/callback',
      scopes: DEFAULT_SCOPES,
    }, store, mockFetch as unknown as typeof fetch);

    const { state } = authService.createLoginUrl();

    const session = await authService.handleCallback('eve_auth_code', state);
    expect(session.characterId).toBe(12345678);
    expect(session.characterName).toBe('Major Trader');
    expect(session.accessToken).toBe(mockToken);
    expect(session.refreshToken).toBe('valid_refresh_token');

    // Public session info should not leak accessToken or refreshToken
    const publicInfo = authService.getPublicSessionInfo(session);
    expect(publicInfo.authenticated).toBe(true);
    expect(publicInfo.character?.characterId).toBe(12345678);
    expect(publicInfo.character?.characterName).toBe('Major Trader');
    expect((publicInfo as unknown as Record<string, unknown>).accessToken).toBeUndefined();
    expect((publicInfo as unknown as Record<string, unknown>).refreshToken).toBeUndefined();
  });

  it('refreshes expiring tokens automatically on getValidSession', async () => {
    const refreshedToken = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:12345678',
      name: 'Major Trader',
      scp: DEFAULT_SCOPES,
      exp: futureExp + 3600,
      azp: 'my_client',
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async (): Promise<EveTokenResponse> => ({
        access_token: refreshedToken,
        token_type: 'Bearer',
        expires_in: 1200,
        refresh_token: 'new_refresh_token',
      }),
    });

    authService = new AuthService({
      clientId: 'my_client',
      clientSecret: 'my_secret',
    }, store, mockFetch as unknown as typeof fetch);

    // Create session expiring in 10 seconds (requires refresh)
    const session = store.createSession({
      characterId: 12345678,
      characterName: 'Major Trader',
      scopes: DEFAULT_SCOPES,
      accessToken: 'old_token',
      refreshToken: 'old_refresh',
      expiresAt: Date.now() + 10000,
    });

    const validSession = await authService.getValidSession(session.sessionId);
    expect(validSession).not.toBeNull();
    expect(validSession?.accessToken).toBe(refreshedToken);
    expect(validSession?.refreshToken).toBe('new_refresh_token');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('supports linking multiple characters to the same session, switching, and unlinking', async () => {
    const char1Token = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:11111111',
      name: 'Buyer Character',
      scp: DEFAULT_SCOPES,
      exp: futureExp,
      azp: 'my_client',
    });

    const char2Token = createMockJwt({
      iss: 'login.eveonline.com',
      sub: 'CHARACTER:EVE:22222222',
      name: 'Seller Character',
      scp: DEFAULT_SCOPES,
      exp: futureExp,
      azp: 'my_client',
    });

    let currentMockToken = char1Token;
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async (): Promise<EveTokenResponse> => ({
        access_token: currentMockToken,
        token_type: 'Bearer',
        expires_in: 1200,
        refresh_token: 'refresh_' + currentMockToken.slice(-5),
      }),
    }));

    authService = new AuthService({
      clientId: 'my_client',
      clientSecret: 'my_secret',
    }, store, mockFetch as unknown as typeof fetch);

    // 1. Initial login with Character 1
    const { state: state1 } = authService.createLoginUrl();
    const session1 = await authService.handleCallback('code_char1', state1);
    expect(session1.characterId).toBe(11111111);
    expect(Object.keys(session1.characters).length).toBe(1);

    // 2. Link Character 2 to the same session via state-preserved sessionId (even if callback has no cookie)
    currentMockToken = char2Token;
    const { state: state2 } = authService.createLoginUrl(undefined, session1.sessionId);
    // Notice we do NOT pass existingSessionId as 3rd arg: it is recovered automatically from OAuth state
    const session2 = await authService.handleCallback('code_char2', state2);
    expect(session2.sessionId).toBe(session1.sessionId);
    expect(session2.characterId).toBe(22222222); // Character 2 is now active
    expect(Object.keys(session2.characters).length).toBe(2);

    // 3. Public session info lists both characters with active flag
    const publicInfo = authService.getPublicSessionInfo(session2);
    expect(publicInfo.characters?.length).toBe(2);
    const char1Info = publicInfo.characters?.find((c) => c.characterId === 11111111);
    const char2Info = publicInfo.characters?.find((c) => c.characterId === 22222222);
    expect(char1Info).toBeDefined();
    expect(char1Info?.isActive).toBe(false);
    expect(char2Info).toBeDefined();
    expect(char2Info?.isActive).toBe(true);

    // 4. Test refreshing tokens for an individual character in the session
    const refreshedTokenChar1 = await authService.refreshCharacterTokens(session1.sessionId, 11111111);
    expect(refreshedTokenChar1).toBeDefined();

    // 5. Switch active character back to Character 1
    const switched = authService.switchActiveCharacter(session1.sessionId, 11111111);
    expect(switched?.characterId).toBe(11111111);
    expect(switched?.activeCharacterId).toBe(11111111);
    expect(switched?.characterName).toBe('Buyer Character');

    // 6. Unlink Character 2
    const afterUnlink = authService.removeCharacter(session1.sessionId, 22222222);
    expect(afterUnlink).not.toBeNull();
    expect(Object.keys(afterUnlink!.characters).length).toBe(1);
    expect(afterUnlink!.characters[22222222]).toBeUndefined();
  });
});

describe('Phase F11 — Qualifications Réelles & Critères de Sortie', () => {
  let store: SessionStore;
  let authService: AuthService;
  let app: express.Express;

  beforeEach(() => {
    store = new SessionStore();
    authService = new AuthService(
      { clientId: 'test_client', clientSecret: 'test_secret' },
      store
    );
    app = express();
    app.use(cookieParser());
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(authService));
  });

  it("TEST-F11-02: auto-refresh silencieux des tokens expirés pour l'ensemble des personnages de la flotte", async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url, options) => {
      const body = options?.body as string;
      const params = new URLSearchParams(body);
      const refreshToken = params.get('refresh_token');

      return {
        ok: true,
        json: async (): Promise<EveTokenResponse> => ({
          access_token: `refreshed_access_${refreshToken}`,
          token_type: 'Bearer',
          expires_in: 1200,
          refresh_token: `new_refresh_${refreshToken}`,
        }),
      };
    });

    const multiAuthService = new AuthService(
      { clientId: 'test_client', clientSecret: 'test_secret' },
      store,
      mockFetch as unknown as typeof fetch
    );
    const multiApp = express();
    multiApp.use(cookieParser());
    multiApp.use(express.json());
    multiApp.use('/api/auth', createAuthRouter(multiAuthService));

    const expiredTs = Date.now() - 300000; // expired 5 mins ago
    const session = store.createSession({
      characterId: 9001,
      characterName: 'Fleet Leader',
      scopes: ['publicData'],
      accessToken: 'old_access_9001',
      refreshToken: 'old_refresh_9001',
      expiresAt: expiredTs,
    });

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 9002,
        characterName: 'Fleet Scout',
        scopes: ['publicData'],
        accessToken: 'old_access_9002',
        refreshToken: 'old_refresh_9002',
        expiresAt: expiredTs,
      },
      false
    );

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 9003,
        characterName: 'Fleet Hauler',
        scopes: ['publicData'],
        accessToken: 'old_access_9003',
        refreshToken: 'old_refresh_9003',
        expiresAt: expiredTs,
      },
      false
    );

    const res = await request(multiApp)
      .get('/api/auth/session')
      .set('Cookie', `eve_session_id=${session.sessionId}`);

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.characters).toHaveLength(3);

    expect(mockFetch).toHaveBeenCalled();
    const updatedSession = store.getSession(session.sessionId);
    expect(updatedSession?.expiresAt).toBeGreaterThan(Date.now());
    expect(updatedSession?.characters[9001].expiresAt).toBeGreaterThan(Date.now());
    expect(updatedSession?.characters[9002].expiresAt).toBeGreaterThan(Date.now());
    expect(updatedSession?.characters[9003].expiresAt).toBeGreaterThan(Date.now());
  });

  it('TEST-F11-03: transport Bearer sans cookie (Iframe Google AI Studio resilience)', async () => {
    const session = store.createSession({
      characterId: 9001,
      characterName: 'Iframe Pilot',
      scopes: ['publicData'],
      accessToken: 'valid_access_token',
      refreshToken: 'valid_refresh_token',
      expiresAt: Date.now() + 1200000,
    });

    // 1. Request WITHOUT cookie but WITH Authorization: Bearer <sessionId>
    const bearerRes = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${session.sessionId}`);

    expect(bearerRes.status).toBe(200);
    expect(bearerRes.body.authenticated).toBe(true);
    expect(bearerRes.body.character.characterId).toBe(9001);
    expect(bearerRes.body.character.characterName).toBe('Iframe Pilot');
    expect(bearerRes.body.sessionId).toBe(session.sessionId);

    // 2. Request WITHOUT cookie but WITH X-Session-ID: <sessionId>
    const customHeaderRes = await request(app)
      .get('/api/auth/session')
      .set('X-Session-ID', session.sessionId);

    expect(customHeaderRes.status).toBe(200);
    expect(customHeaderRes.body.authenticated).toBe(true);
    expect(customHeaderRes.body.character.characterId).toBe(9001);
  });

  it('TEST-F11-05: export et import de trousseau de flotte chiffré', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async (): Promise<EveTokenResponse> => ({
        access_token: 'valid_restored_access',
        token_type: 'Bearer',
        expires_in: 1200,
        refresh_token: 'valid_restored_refresh',
      }),
    }));

    const fleetAuthService = new AuthService(
      { clientId: 'test_client', clientSecret: 'test_secret' },
      store,
      mockFetch as unknown as typeof fetch
    );
    const fleetApp = express();
    fleetApp.use(cookieParser());
    fleetApp.use(express.json());
    fleetApp.use('/api/auth', createAuthRouter(fleetAuthService));

    const session = store.createSession({
      characterId: 9001,
      characterName: 'Fleet Commander Alpha',
      scopes: ['esi-wallet.read_character_wallet.v1'],
      accessToken: 'access_alpha',
      refreshToken: 'refresh_alpha',
      expiresAt: Date.now() + 1200000,
    });
    store.addOrUpdateCharacter(session.sessionId, {
      characterId: 9002,
      characterName: 'Fleet Scout Beta',
      scopes: ['esi-assets.read_assets.v1'],
      accessToken: 'access_beta',
      refreshToken: 'refresh_beta',
      expiresAt: Date.now() + 1200000,
    });

    const password = 'CorrectFleetPassword2026!';
    const exportRes = await request(fleetApp)
      .post('/api/auth/fleet/export')
      .set('Authorization', `Bearer ${session.sessionId}`)
      .send({ password });

    expect(exportRes.status).toBe(200);
    expect(exportRes.body.success).toBe(true);
    expect(exportRes.body.filename).toBe('eve-fleet-backup.enc');
    expect(exportRes.body.fleetCount).toBe(2);
    const encryptedPayload = exportRes.body.encryptedData;
    expect(encryptedPayload).toBeDefined();

    store.clearAll();
    expect(store.getSession(session.sessionId)).toBeNull();

    const wrongPassRes = await request(fleetApp)
      .post('/api/auth/fleet/import')
      .send({
        encryptedData: encryptedPayload,
        password: 'WrongPassword!',
      });

    expect(wrongPassRes.status).toBe(400);
    expect(wrongPassRes.body.error).toContain('Mot de passe incorrect');

    const importRes = await request(fleetApp)
      .post('/api/auth/fleet/import')
      .send({
        encryptedData: encryptedPayload,
        password: password,
      });

    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    expect(importRes.body.restoredCharacters).toBe(2);
    expect(importRes.body.sessionId).toBeDefined();
    expect(importRes.body.characters).toHaveLength(2);

    const restoredSession = store.getSession(importRes.body.sessionId);
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.characters[9001].characterName).toBe('Fleet Commander Alpha');
    expect(restoredSession?.characters[9002].characterName).toBe('Fleet Scout Beta');
  });

  describe('Phase G01 — Single-Flight OAuth & Production Route Hardening', () => {
    it('TEST-G01-04: single-flight OAuth deduplication: 50 concurrent requests trigger exactly ONE token refresh call to CCP', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        // Introduce small async delay to ensure all 50 concurrent calls overlap
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          json: async (): Promise<EveTokenResponse> => ({
            access_token: 'single_flight_fresh_access_token',
            token_type: 'Bearer',
            expires_in: 1200,
            refresh_token: 'single_flight_fresh_refresh_token',
          }),
        };
      });

      const singleFlightAuthService = new AuthService(
        { clientId: 'test_client', clientSecret: 'test_secret' },
        store,
        mockFetch as unknown as typeof fetch
      );

      const expiredTs = Date.now() - 60000;
      const session = store.createSession({
        characterId: 888001,
        characterName: 'High Concurrency Pilot',
        scopes: ['publicData'],
        accessToken: 'expired_access_token',
        refreshToken: 'valid_refresh_token_to_coalesce',
        expiresAt: expiredTs,
      });

      // Launch 50 concurrent requests simultaneously
      const promises = Array.from({ length: 50 }, () =>
        singleFlightAuthService.getValidSession(session.sessionId)
      );

      const results = await Promise.all(promises);

      // Verify all 50 callers received the valid refreshed session
      expect(results).toHaveLength(50);
      for (const res of results) {
        expect(res).not.toBeNull();
        expect(res?.accessToken).toBe('single_flight_fresh_access_token');
        expect(res?.refreshToken).toBe('single_flight_fresh_refresh_token');
        expect(res?.expiresAt).toBeGreaterThan(Date.now());
      }

      // Assert that CCP token endpoint was invoked EXACTLY ONCE
      expect(callCount).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('TEST-G01-05: physical route lock: E2E test routes return HTTP 404 in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        process.env.SESSION_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

        const prodApp = express();
        prodApp.use(cookieParser());
        prodApp.use(express.json());
        prodApp.use('/api/auth', createAuthRouter(authService));

        const resSession = await request(prodApp)
          .post('/api/auth/e2e-session')
          .send({ characterId: 999 });
        expect(resSession.status).toBe(404);

        const resSeed = await request(prodApp)
          .post('/api/auth/e2e-seed')
          .send({});
        expect(resSeed.status).toBe(404);

        const resReset = await request(prodApp)
          .post('/api/auth/e2e-reset')
          .send({});
        expect(resReset.status).toBe(404);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
