// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.ts';
import { extractAndValidateCharacterIdentity } from './jwt.ts';
import { SessionStore } from './sessionStore.ts';

import { AuthService, DEFAULT_SCOPES } from './service.ts';
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

    store.saveOAuthState(state, verifier);

    // First consumption succeeds
    const consumed = store.consumeOAuthState(state);
    expect(consumed).toBe(verifier);

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
});
