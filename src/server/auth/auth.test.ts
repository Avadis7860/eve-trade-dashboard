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

  describe('Fleet Persistence & Landing Page Recovery Endpoints', () => {
    it('TEST-F11-06: GET /api/auth/saved-sessions lists available saved fleets with character counts', async () => {
      const fleetSession = store.createSession({
        characterId: 77701,
        characterName: 'Fleet Admiral',
        scopes: ['publicData'],
        accessToken: 'access_admiral',
        refreshToken: 'refresh_admiral',
        expiresAt: Date.now() + 1200000,
      });
      store.addOrUpdateCharacter(fleetSession.sessionId, {
        characterId: 77702,
        characterName: 'Fleet Logi Alt',
        scopes: ['publicData'],
        accessToken: 'access_logi',
        refreshToken: 'refresh_logi',
        expiresAt: Date.now() + 1200000,
      }, false);

      const res = await request(app).get('/api/auth/saved-sessions');
      expect(res.status).toBe(200);
      expect(res.body.savedSessions).toBeInstanceOf(Array);
      expect(res.body.savedSessions.length).toBeGreaterThanOrEqual(1);

      const found = res.body.savedSessions.find((s: { sessionId: string }) => s.sessionId === fleetSession.sessionId);
      expect(found).toBeDefined();
      expect(found.activeCharacterName).toBe('Fleet Admiral');
      expect(found.charactersCount).toBe(2);
      expect(found.characterNames).toContain('Fleet Admiral');
      expect(found.characterNames).toContain('Fleet Logi Alt');
      expect(found.portraitUrl).toContain('77701');
    });

    it('TEST-F11-07: POST /api/auth/resume restores full multi-character fleet in 1 click and sets cookie', async () => {
      const fleetSession = store.createSession({
        characterId: 88801,
        characterName: 'Hauler Prime',
        scopes: ['publicData'],
        accessToken: 'access_hauler',
        refreshToken: 'refresh_hauler',
        expiresAt: Date.now() + 1200000,
      });

      // Resume with explicit sessionId
      const res = await request(app)
        .post('/api/auth/resume')
        .send({ sessionId: fleetSession.sessionId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.sessionId).toBe(fleetSession.sessionId);
      expect(res.body.character.characterName).toBe('Hauler Prime');

      // Verify Set-Cookie header
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toContain('eve_session_id=');

      // Resume without sessionId (auto-picks latest)
      const resAuto = await request(app).post('/api/auth/resume').send({});
      expect(resAuto.status).toBe(200);
      expect(resAuto.body.authenticated).toBe(true);
    });

    it('TEST-F11-08: GET /api/auth/session returns savedSessions metadata when unauthenticated and supports auto_resume', async () => {
      // 1. Unauthenticated request without auto_resume returns savedSessions
      const unauthRes = await request(app).get('/api/auth/session');
      expect(unauthRes.status).toBe(200);
      expect(unauthRes.body.authenticated).toBe(false);
      expect(unauthRes.body.savedSessions).toBeInstanceOf(Array);
      expect(unauthRes.body.savedSessions.length).toBeGreaterThan(0);

      // 2. Unauthenticated request with auto_resume=true directly restores the session
      const autoRes = await request(app).get('/api/auth/session?auto_resume=true');
      expect(autoRes.status).toBe(200);
      expect(autoRes.body.authenticated).toBe(true);
      expect(autoRes.body.sessionId).toBeDefined();
    });

    it('TEST-F11-09: GET /api/auth/login?session_id=<id> preserves fleet session ID for linking', async () => {
      const fleetSession = store.createSession({
        characterId: 99901,
        characterName: 'Fleet Boss',
        scopes: ['publicData'],
        accessToken: 'access_boss',
        refreshToken: 'refresh_boss',
        expiresAt: Date.now() + 1200000,
      });

      const res = await request(app).get(`/api/auth/login?session_id=${fleetSession.sessionId}&format=json`);
      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();

      const url = new URL(res.body.url);
      const state = url.searchParams.get('state');
      expect(state).toBeDefined();

      // Check that store has saved the state with the provided sessionId
      const consumed = store.consumeOAuthState(state!);
      expect(consumed).not.toBeNull();
      expect(consumed?.sessionId).toBe(fleetSession.sessionId);
    });
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

  describe('Phase S01: Deterministic Logout & Bearer Session Invalidation', () => {
    let authService: AuthService;
    let store: SessionStore;
    let app: express.Express;

    beforeEach(() => {
      store = new SessionStore();
      authService = new AuthService(undefined, store);
      app = express();
      app.use(cookieParser());
      app.use(express.json());
      app.use('/api/auth', createAuthRouter(authService, store));
    });

    it('TEST-S01-01: invalidates session via Authorization: Bearer <sessionId> header', async () => {
      const session = store.createSession({
        characterId: 9001,
        characterName: 'Bearer Logout Pilot',
        scopes: ['publicData'],
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token',
        expiresAt: Date.now() + 3600000,
      });

      expect(store.getSession(session.sessionId)).not.toBeNull();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${session.sessionId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Session must be purged from store
      expect(store.getSession(session.sessionId)).toBeNull();

      // Subsequent session check returns unauthenticated
      const checkRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${session.sessionId}`);
      expect(checkRes.status).toBe(200);
      expect(checkRes.body.authenticated).toBe(false);
    });

    it('TEST-S01-02: invalidates session via X-Session-ID header', async () => {
      const session = store.createSession({
        characterId: 9002,
        characterName: 'X-Session Logout Pilot',
        scopes: ['publicData'],
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token',
        expiresAt: Date.now() + 3600000,
      });

      expect(store.getSession(session.sessionId)).not.toBeNull();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('X-Session-ID', session.sessionId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(store.getSession(session.sessionId)).toBeNull();
    });

    it('TEST-S01-03: invalidates session via JSON body { sessionId }', async () => {
      const session = store.createSession({
        characterId: 9003,
        characterName: 'Body Logout Pilot',
        scopes: ['publicData'],
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token',
        expiresAt: Date.now() + 3600000,
      });

      expect(store.getSession(session.sessionId)).not.toBeNull();

      const res = await request(app)
        .post('/api/auth/logout')
        .send({ sessionId: session.sessionId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(store.getSession(session.sessionId)).toBeNull();
    });

    it('TEST-S01-04: once session is deleted via logout, subsequent request without auto_resume returns unauthenticated', async () => {
      const session = store.createSession({
        characterId: 9004,
        characterName: 'No Auto Resume Pilot',
        scopes: ['publicData'],
        accessToken: 'valid_access_token',
        refreshToken: 'valid_refresh_token',
        expiresAt: Date.now() + 3600000,
      });

      await request(app)
        .post('/api/auth/logout')
        .send({ sessionId: session.sessionId });

      const sessionRes = await request(app).get('/api/auth/session');
      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.authenticated).toBe(false);
      expect(sessionRes.body.character).toBeUndefined();
    });

    it('TEST-AUTH-REFRESH-01: POST /api/auth/refresh refreshes all characters in session and returns updated info', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'fresh_access_token_123',
          token_type: 'Bearer',
          expires_in: 1200,
          refresh_token: 'fresh_refresh_token_456',
        }),
      }));
      const refreshAuthService = new AuthService(
        { clientId: 'test_client', clientSecret: 'test_secret' },
        store,
        mockFetch as unknown as typeof fetch
      );
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(refreshAuthService, store));

      const session = store.createSession({
        characterId: 9005,
        characterName: 'Refresh Fleet Leader',
        scopes: ['esi-wallet.read_character_wallet.v1'],
        accessToken: 'old_access_token',
        refreshToken: 'old_refresh_token',
        expiresAt: Date.now() - 1000, // expired
      });

      const res = await request(testApp)
        .post('/api/auth/refresh')
        .set('X-Session-ID', session.sessionId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.authenticated).toBe(true);

      const updated = store.getSession(session.sessionId);
      expect(updated?.accessToken).toBe('fresh_access_token_123');
      expect(updated?.refreshToken).toBe('fresh_refresh_token_456');
    });

    it('TEST-AUTH-REFRESH-02: POST /api/auth/character/:characterId/refresh refreshes specific character', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'fresh_char_token',
          token_type: 'Bearer',
          expires_in: 1200,
          refresh_token: 'fresh_char_refresh',
        }),
      }));
      const refreshAuthService = new AuthService(
        { clientId: 'test_client', clientSecret: 'test_secret' },
        store,
        mockFetch as unknown as typeof fetch
      );
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(refreshAuthService, store));

      const session = store.createSession({
        characterId: 9006,
        characterName: 'Single Refresh Pilot',
        scopes: ['esi-wallet.read_character_wallet.v1'],
        accessToken: 'initial_token',
        refreshToken: 'initial_refresh',
        expiresAt: Date.now() + 3600000,
      });

      const res = await request(testApp)
        .post(`/api/auth/character/9006/refresh`)
        .set('Authorization', `Bearer ${session.sessionId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = store.getSession(session.sessionId);
      expect(updated?.characters[9006].accessToken).toBe('fresh_char_token');
    });

    it('TEST-AUTH-REFRESH-03: getValidSession maintains session when CCP token refresh has transient error', async () => {
      const mockFetch = vi.fn().mockImplementation(async () => ({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      }));
      const resilientAuthService = new AuthService(
        { clientId: 'test_client', clientSecret: 'test_secret' },
        store,
        mockFetch as unknown as typeof fetch
      );

      const session = store.createSession({
        characterId: 9007,
        characterName: 'Resilient Pilot',
        scopes: ['publicData'],
        accessToken: 'expired_access_token',
        refreshToken: 'durable_refresh_token',
        expiresAt: Date.now() - 5000, // expired
      });

      // getValidSession should NOT return null or delete session on transient refresh failure
      const result = await resilientAuthService.getValidSession(session.sessionId);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(session.sessionId);
      expect(store.getSession(session.sessionId)).not.toBeNull();
    });
  });

  describe('Phase S02 — Sélection et Invariance du Personnage Principal', () => {
    it('TEST-S02-05: POST /api/auth/switch with Bearer token switches active character and returns isActive badges', async () => {
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(authService, store));

      const session = store.createSession({
        characterId: 1001,
        characterName: 'Leader Char',
        scopes: ['publicData'],
        accessToken: 'leader-token',
        refreshToken: 'leader-refresh',
        expiresAt: Date.now() + 3600000,
      });

      store.addOrUpdateCharacter(
        session.sessionId,
        {
          characterId: 1002,
          characterName: 'Second Char',
          scopes: ['publicData', 'esi-markets.read_character_orders.v1'],
          accessToken: 'second-token',
          refreshToken: 'second-refresh',
          expiresAt: Date.now() + 3600000,
        },
        false
      );

      // Call switch via Bearer token
      const res = await request(testApp)
        .post('/api/auth/switch')
        .set('Authorization', `Bearer ${session.sessionId}`)
        .send({ characterId: 1002 });

      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(true);
      expect(res.body.character.characterId).toBe(1002);
      expect(res.body.character.characterName).toBe('Second Char');

      // Verify characters array contains correct isActive flag
      const chars = res.body.characters;
      expect(chars).toHaveLength(2);
      const c1001 = chars.find((c: { characterId: number }) => c.characterId === 1001);
      const c1002 = chars.find((c: { characterId: number }) => c.characterId === 1002);
      expect(c1001?.isActive).toBe(false);
      expect(c1002?.isActive).toBe(true);

      // Verify store state
      const updated = store.getSession(session.sessionId);
      expect(updated?.activeCharacterId).toBe(1002);
      expect(updated?.characterId).toBe(1002);
      expect(updated?.characterName).toBe('Second Char');
    });

    it('TEST-S02-06: POST /api/auth/switch validates missing input (400) and unknown character (404)', async () => {
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(authService, store));

      const session = store.createSession({
        characterId: 2001,
        characterName: 'Solo Pilot',
        scopes: ['publicData'],
        accessToken: 'solo-token',
        refreshToken: 'solo-refresh',
        expiresAt: Date.now() + 3600000,
      });

      // Missing sessionId -> 400
      const resNoSession = await request(testApp)
        .post('/api/auth/switch')
        .send({ characterId: 2001 });
      expect(resNoSession.status).toBe(400);

      // Missing characterId -> 400
      const resNoChar = await request(testApp)
        .post('/api/auth/switch')
        .set('X-Session-ID', session.sessionId)
        .send({});
      expect(resNoChar.status).toBe(400);

      // Character not in session -> 404
      const resNotFound = await request(testApp)
        .post('/api/auth/switch')
        .set('Authorization', `Bearer ${session.sessionId}`)
        .send({ characterId: 99999999 });
      expect(resNotFound.status).toBe(404);
    });

    it('TEST-S02-07: DELETE /api/auth/character/:characterId unlinks cleanly with Bearer transport', async () => {
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(authService, store));

      const session = store.createSession({
        characterId: 3001,
        characterName: 'Fleet Active Pilot',
        scopes: ['publicData'],
        accessToken: 'token-3001',
        refreshToken: 'refresh-3001',
        expiresAt: Date.now() + 3600000,
      });

      store.addOrUpdateCharacter(
        session.sessionId,
        {
          characterId: 3002,
          characterName: 'Fleet Alt Pilot',
          scopes: ['publicData'],
          accessToken: 'token-3002',
          refreshToken: 'refresh-3002',
          expiresAt: Date.now() + 3600000,
        },
        false
      );

      // Unlink non-active character 3002
      const res1 = await request(testApp)
        .delete('/api/auth/character/3002')
        .set('Authorization', `Bearer ${session.sessionId}`);

      expect(res1.status).toBe(200);
      expect(res1.body.authenticated).toBe(true);
      expect(res1.body.character.characterId).toBe(3001); // remains 3001
      expect(res1.body.characters).toHaveLength(1);

      // Unlink active character 3001 (now only 1 character left)
      store.addOrUpdateCharacter(
        session.sessionId,
        {
          characterId: 3003,
          characterName: 'Replacement Alt',
          scopes: ['publicData'],
          accessToken: 'token-3003',
          refreshToken: 'refresh-3003',
          expiresAt: Date.now() + 3600000,
        },
        false
      );

      const res2 = await request(testApp)
        .delete('/api/auth/character/3001')
        .set('X-Session-ID', session.sessionId);

      expect(res2.status).toBe(200);
      expect(res2.body.character.characterId).toBe(3003); // transitioned to 3003

      // Unlink the last character -> session destroyed
      const res3 = await request(testApp)
        .delete('/api/auth/character/3003')
        .set('Authorization', `Bearer ${session.sessionId}`);

      expect(res3.status).toBe(200);
      expect(res3.body.authenticated).toBe(false);
      expect(store.getSession(session.sessionId)).toBeNull();
    });

    it('TEST-S02-08: activeCharacterId is strictly invariant when refreshing 10 expired characters in fleet', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            access_token: `refreshed_token_${callCount}`,
            token_type: 'Bearer',
            expires_in: 1200,
            refresh_token: `refreshed_refresh_${callCount}`,
          }),
        };
      });

      const multiAuthService = new AuthService(
        { clientId: 'multi_client', clientSecret: 'multi_secret' },
        store,
        mockFetch as unknown as typeof fetch
      );

      // Create session with chosen active character #4005
      const session = store.createSession({
        characterId: 4001,
        characterName: 'Char 1',
        scopes: ['publicData'],
        accessToken: 'old_1',
        refreshToken: 'ref_1',
        expiresAt: Date.now() - 1000, // expired
      });

      for (let i = 2; i <= 10; i++) {
        store.addOrUpdateCharacter(
          session.sessionId,
          {
            characterId: 4000 + i,
            characterName: `Char ${i}`,
            scopes: ['publicData'],
            accessToken: `old_${i}`,
            refreshToken: `ref_${i}`,
            expiresAt: Date.now() - 1000, // all expired
          },
          false
        );
      }

      // Explicitly set active character to 4005
      store.switchActiveCharacter(session.sessionId, 4005);
      expect(store.getSession(session.sessionId)?.activeCharacterId).toBe(4005);

      // Perform getValidSession which triggers refreshAllExpiredCharacters
      const validSession = await multiAuthService.getValidSession(session.sessionId);
      expect(validSession).not.toBeNull();

      // INVARIANCE ASSERTION: activeCharacterId MUST remain 4005!
      expect(validSession?.activeCharacterId).toBe(4005);
      expect(validSession?.characterId).toBe(4005);
      expect(validSession?.characterName).toBe('Char 5');

      const publicInfo = multiAuthService.getPublicSessionInfo(validSession);
      expect(publicInfo.character?.characterId).toBe(4005);
      expect(publicInfo.character?.characterName).toBe('Char 5');

      const activeInList = publicInfo.characters?.find((c) => c.isActive);
      expect(activeInList?.characterId).toBe(4005);
    });

    it('TEST-S03-04: GET /api/auth/login?session_id=...&format=json binds session_id to OAuth state for fleet expansion', async () => {
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(authService, store));

      const existingSession = store.createSession({
        characterId: 8001,
        characterName: 'Fleet Leader',
        scopes: ['publicData'],
        accessToken: 'tk-8001',
        refreshToken: 'rf-8001',
        expiresAt: Date.now() + 1000000,
      });

      const res = await request(testApp)
        .get(`/api/auth/login?format=json&session_id=${existingSession.sessionId}`);

      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();

      const parsedUrl = new URL(res.body.url);
      const state = parsedUrl.searchParams.get('state');
      expect(state).toBeDefined();

      // Verify that SessionStore registered the pending state associated with the existing session
      const pendingState = store.consumeOAuthState(state!);
      expect(pendingState).not.toBeNull();
      expect(pendingState?.sessionId).toBe(existingSession.sessionId);
    });

    it('TEST-S03-05: GET /api/auth/callback responds with resilient HTML containing BroadcastChannel, storage events, and close button without crashing when window.opener is null', async () => {
      const testApp = express();
      testApp.use(cookieParser());
      testApp.use(express.json());
      testApp.use('/api/auth', createAuthRouter(authService, store));

      const callbackCharId = 8801;

      // Mock handleCallback directly to test callback HTML response and iframe resilience
      vi.spyOn(authService, 'handleCallback').mockResolvedValueOnce({
        sessionId: 'session_s03_test',
        activeCharacterId: callbackCharId,
        characterId: callbackCharId,
        characterName: 'Resilient Pilot',
        scopes: ['publicData'],
        accessToken: 'tk_s03',
        refreshToken: 'rf_s03',
        expiresAt: Date.now() + 1200000,
        createdAt: Date.now(),
        characters: {
          [callbackCharId]: {
            characterId: callbackCharId,
            characterName: 'Resilient Pilot',
            scopes: ['publicData'],
            accessToken: 'tk_s03',
            refreshToken: 'rf_s03',
            expiresAt: Date.now() + 1200000,
            createdAt: Date.now(),
          },
        },
      });

      const res = await request(testApp)
        .get('/api/auth/callback?code=mock_code_123&state=mock_state_123');

      expect(res.status).toBe(200);
      expect(res.text).toContain('Authentification Réussie');
      expect(res.text).toContain('eve_sso_channel');
      expect(res.text).toContain('eve_auth_event');
      expect(res.text).toContain('Fermer cette fenêtre');
      expect(res.text).toContain('window.close()');
    });

    it('TEST-S03-06: full 11-character fleet expansion persists all 11 linked characters under a single session', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 1200;
      let charIndex = 0;

      const multiFetch = vi.fn().mockImplementation(async () => {
        charIndex++;
        const charId = 9000 + charIndex;
        const charToken = createMockJwt({
          iss: 'login.eveonline.com',
          sub: `CHARACTER:EVE:${charId}`,
          name: `Fleet ${charIndex}`,
          owner: `owner_${charId}`,
          scp: ['publicData'],
          exp: futureExp,
          azp: 'fleet_client',
        });
        return {
          ok: true,
          json: async () => ({
            access_token: charToken,
            token_type: 'Bearer',
            expires_in: 1200,
            refresh_token: `rf_${charIndex}`,
          }),
        };
      });

      const fleetAuthService = new AuthService(
        { clientId: 'fleet_client', clientSecret: 'fleet_secret', callbackUrl: 'http://localhost:3000/api/auth/callback' },
        store,
        multiFetch as unknown as typeof fetch
      );

      // 1. Initial login for character #1
      const { state: state1 } = fleetAuthService.createLoginUrl();
      const session = await fleetAuthService.handleCallback('code_1', state1);
      const fleetSessionId = session.sessionId;

      // 2. Link 10 additional characters sequentially using session_id
      for (let i = 2; i <= 11; i++) {
        const { state: stateI } = fleetAuthService.createLoginUrl(undefined, fleetSessionId);
        await fleetAuthService.handleCallback(`code_${i}`, stateI, fleetSessionId);
      }

      // 3. Verify that the session has all 11 characters
      const fleetSession = store.getSession(fleetSessionId);
      expect(fleetSession).not.toBeNull();
      expect(fleetSession?.sessionId).toBe(fleetSessionId);
      expect(Object.keys(fleetSession!.characters)).toHaveLength(11);

      for (let i = 1; i <= 11; i++) {
        const charId = 9000 + i;
        expect(fleetSession?.characters[charId]).toBeDefined();
        expect(fleetSession?.characters[charId].characterName).toBe(`Fleet ${i}`);
      }
    });
  });
});
