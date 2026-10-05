import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { SessionStore } from './sessionStore.ts';
import { DurableFileDatabaseAdapter } from '../storage/database.ts';

const TEST_DB_PATH = './.data/test_session_store.json';

describe('Phase F11 — SessionStore Persistence & Token Encryption at Rest', () => {
  let adapter: DurableFileDatabaseAdapter;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    adapter = new DurableFileDatabaseAdapter(TEST_DB_PATH);
    adapter.init();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('TEST-F11-01: multi-character session survives server restart / fresh store instance', () => {
    const store1 = new SessionStore(adapter);

    const session = store1.createSession({
      characterId: 9001,
      characterName: 'Trader Alpha',
      scopes: ['esi-wallet.read_character_wallet.v1'],
      accessToken: 'access-token-alpha-plain',
      refreshToken: 'refresh-token-alpha-plain',
      expiresAt: Date.now() + 1200000,
    });

    store1.addOrUpdateCharacter(session.sessionId, {
      characterId: 9002,
      characterName: 'Trader Beta',
      scopes: ['esi-wallet.read_character_wallet.v1', 'esi-assets.read_assets.v1'],
      accessToken: 'access-token-beta-plain',
      refreshToken: 'refresh-token-beta-plain',
      expiresAt: Date.now() + 1200000,
    });

    expect(store1.getSession(session.sessionId)?.characters).toBeDefined();
    expect(Object.keys(store1.getSession(session.sessionId)!.characters)).toHaveLength(2);

    // Simulate complete Node process restart: new adapter and new SessionStore instance
    const restartedAdapter = new DurableFileDatabaseAdapter(TEST_DB_PATH);
    restartedAdapter.init();
    const store2 = new SessionStore(restartedAdapter);

    const restoredSession = store2.getSession(session.sessionId);
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.sessionId).toBe(session.sessionId);
    expect(restoredSession?.activeCharacterId).toBe(9002);
    expect(Object.keys(restoredSession!.characters)).toHaveLength(2);

    expect(restoredSession?.characters[9001].characterName).toBe('Trader Alpha');
    expect(restoredSession?.characters[9001].refreshToken).toBe('refresh-token-alpha-plain');
    expect(restoredSession?.characters[9001].accessToken).toBe('access-token-alpha-plain');

    expect(restoredSession?.characters[9002].characterName).toBe('Trader Beta');
    expect(restoredSession?.characters[9002].refreshToken).toBe('refresh-token-beta-plain');
    expect(restoredSession?.characters[9002].accessToken).toBe('access-token-beta-plain');
  });

  it('TEST-F11-04: refresh and access tokens are strictly encrypted at rest in storage (IV:Tag:Data)', () => {
    const store = new SessionStore(adapter);

    const session = store.createSession({
      characterId: 9001,
      characterName: 'Fleet Commander',
      scopes: ['publicData'],
      accessToken: 'super_secret_access_token_12345',
      refreshToken: 'super_secret_refresh_token_67890',
      expiresAt: Date.now() + 1200000,
    });

    // Read raw file on disk directly
    const rawDiskContent = fs.readFileSync(TEST_DB_PATH, 'utf8');
    expect(rawDiskContent).not.toContain('super_secret_access_token_12345');
    expect(rawDiskContent).not.toContain('super_secret_refresh_token_67890');

    const parsedJson = JSON.parse(rawDiskContent);
    const storedChar = parsedJson.sessions[session.sessionId].characters[9001];

    expect(storedChar.encryptedRefreshToken).toBeDefined();
    expect(storedChar.encryptedAccessToken).toBeDefined();

    // Verify format: hex(iv):hex(tag):hex(data)
    const refreshParts = storedChar.encryptedRefreshToken.split(':');
    expect(refreshParts).toHaveLength(3);
    expect(refreshParts[0]).toHaveLength(24); // 12 bytes IV
    expect(refreshParts[1]).toHaveLength(32); // 16 bytes Tag

    const accessParts = storedChar.encryptedAccessToken.split(':');
    expect(accessParts).toHaveLength(3);
    expect(accessParts[0]).toHaveLength(24);
    expect(accessParts[1]).toHaveLength(32);
  });
});
