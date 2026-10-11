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

  it('TEST-S02-01: switchActiveCharacter updates memory, normalizes numeric ID, and persists immediately across store restart', () => {
    const store1 = new SessionStore(adapter);

    const session = store1.createSession({
      characterId: 8001,
      characterName: 'Hauler Prime',
      scopes: ['publicData'],
      accessToken: 'token-8001',
      refreshToken: 'refresh-8001',
      expiresAt: Date.now() + 1000000,
    });

    store1.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 8002,
        characterName: 'Market Tycoon',
        scopes: ['esi-markets.read_character_orders.v1'],
        accessToken: 'token-8002',
        refreshToken: 'refresh-8002',
        expiresAt: Date.now() + 1000000,
      },
      false // do not make active immediately
    );

    expect(store1.getSession(session.sessionId)?.activeCharacterId).toBe(8001);

    // Switch to 8002 using string or number
    const switched = store1.switchActiveCharacter(session.sessionId, 8002);
    expect(switched).not.toBeNull();
    expect(switched?.activeCharacterId).toBe(8002);
    expect(switched?.characterId).toBe(8002);
    expect(switched?.characterName).toBe('Market Tycoon');

    // Simulate restart
    const store2 = new SessionStore(adapter);
    const restored = store2.getSession(session.sessionId);
    expect(restored).not.toBeNull();
    expect(restored?.activeCharacterId).toBe(8002);
    expect(restored?.characterName).toBe('Market Tycoon');
  });

  it('TEST-S02-02: loadFromStorageSync handles string activeCharacterId safely without resetting to first character', () => {
    const store = new SessionStore(adapter);
    const session = store.createSession({
      characterId: 7001,
      characterName: 'First Pilot',
      scopes: ['publicData'],
      accessToken: 'token-7001',
      refreshToken: 'refresh-7001',
      expiresAt: Date.now() + 1000000,
    });

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 7002,
        characterName: 'Second Pilot',
        scopes: ['publicData'],
        accessToken: 'token-7002',
        refreshToken: 'refresh-7002',
        expiresAt: Date.now() + 1000000,
      },
      true // make active
    );

    // Manually mutate raw JSON to store activeCharacterId as string "7002"
    const rawDisk = JSON.parse(fs.readFileSync(TEST_DB_PATH, 'utf8'));
    rawDisk.sessions[session.sessionId].activeCharacterId = '7002';
    fs.writeFileSync(TEST_DB_PATH, JSON.stringify(rawDisk, null, 2), 'utf8');

    // Reload store
    const restartedAdapter = new DurableFileDatabaseAdapter(TEST_DB_PATH);
    restartedAdapter.init();
    const freshStore = new SessionStore(restartedAdapter);
    const reloaded = freshStore.getSession(session.sessionId);
    expect(reloaded).not.toBeNull();
    // Must resolve to 7002 (number), NOT fall back to 7001
    expect(reloaded?.activeCharacterId).toBe(7002);
    expect(reloaded?.characterName).toBe('Second Pilot');
  });

  it('TEST-S02-03: removeCharacter preserves activeCharacterId when unlinking non-active characters', () => {
    const store = new SessionStore(adapter);
    const session = store.createSession({
      characterId: 6001,
      characterName: 'Active Fleet Commander',
      scopes: ['publicData'],
      accessToken: 'token-6001',
      refreshToken: 'refresh-6001',
      expiresAt: Date.now() + 1000000,
    });

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 6002,
        characterName: 'Alt Scout',
        scopes: ['publicData'],
        accessToken: 'token-6002',
        refreshToken: 'refresh-6002',
        expiresAt: Date.now() + 1000000,
      },
      false
    );

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 6003,
        characterName: 'Alt Miner',
        scopes: ['publicData'],
        accessToken: 'token-6003',
        refreshToken: 'refresh-6003',
        expiresAt: Date.now() + 1000000,
      },
      false
    );

    expect(store.getSession(session.sessionId)?.activeCharacterId).toBe(6001);

    // Remove non-active Alt Scout (6002)
    const afterFirstRemove = store.removeCharacter(session.sessionId, 6002);
    expect(afterFirstRemove).not.toBeNull();
    expect(afterFirstRemove?.activeCharacterId).toBe(6001);
    expect(Object.keys(afterFirstRemove!.characters)).toHaveLength(2);

    // Now remove the active character (6001) -> must transition to a remaining character
    const afterActiveRemove = store.removeCharacter(session.sessionId, 6001);
    expect(afterActiveRemove).not.toBeNull();
    expect(afterActiveRemove?.activeCharacterId).toBe(6003);
    expect(afterActiveRemove?.characterName).toBe('Alt Miner');
  });

  it('TEST-S02-04: updateSessionTokens updates tokens without modifying activeCharacterId', () => {
    const store = new SessionStore(adapter);
    const session = store.createSession({
      characterId: 5001,
      characterName: 'Main Industrialist',
      scopes: ['publicData'],
      accessToken: 'token-5001-old',
      refreshToken: 'refresh-5001-old',
      expiresAt: Date.now() + 1000000,
    });

    store.addOrUpdateCharacter(
      session.sessionId,
      {
        characterId: 5002,
        characterName: 'Side Trader',
        scopes: ['publicData'],
        accessToken: 'token-5002-old',
        refreshToken: 'refresh-5002-old',
        expiresAt: Date.now() + 1000000,
      },
      false
    );

    expect(store.getSession(session.sessionId)?.activeCharacterId).toBe(5001);

    // Refresh tokens for side character 5002
    store.updateSessionTokens(
      session.sessionId,
      'token-5002-fresh',
      'refresh-5002-fresh',
      Date.now() + 5000000,
      5002
    );

    const s = store.getSession(session.sessionId);
    expect(s?.activeCharacterId).toBe(5001);
    expect(s?.characterId).toBe(5001);
    expect(s?.characters[5002].accessToken).toBe('token-5002-fresh');
  });

  it('TEST-S03-01: SessionStore.init() asynchronously reloads full 11-character fleet and accurately restores all members', async () => {
    const store1 = new SessionStore(adapter);

    const mainSession = store1.createSession({
      characterId: 7001,
      characterName: 'Fleet Commander 1',
      scopes: ['publicData'],
      accessToken: 'token-fc-1',
      refreshToken: 'refresh-fc-1',
      expiresAt: Date.now() + 1000000,
    });

    for (let i = 2; i <= 11; i++) {
      store1.addOrUpdateCharacter(
        mainSession.sessionId,
        {
          characterId: 7000 + i,
          characterName: `Fleet Pilot ${i}`,
          scopes: ['publicData'],
          accessToken: `token-pilot-${i}`,
          refreshToken: `refresh-pilot-${i}`,
          expiresAt: Date.now() + 1000000,
        },
        false
      );
    }

    const s1 = store1.getSession(mainSession.sessionId);
    expect(s1).not.toBeNull();
    expect(Object.keys(s1!.characters)).toHaveLength(11);

    // Simulate process restart: fresh adapter and fresh SessionStore instance with async init()
    const restartedAdapter = new DurableFileDatabaseAdapter(TEST_DB_PATH);
    restartedAdapter.init();
    const store2 = new SessionStore(restartedAdapter);

    await store2.init();

    const restored = store2.getSession(mainSession.sessionId);
    expect(restored).not.toBeNull();
    expect(restored?.sessionId).toBe(mainSession.sessionId);
    expect(restored?.activeCharacterId).toBe(7001);
    expect(Object.keys(restored!.characters)).toHaveLength(11);

    for (let i = 1; i <= 11; i++) {
      const charId = 7000 + i;
      expect(restored?.characters[charId]).toBeDefined();
      expect(restored?.characters[charId].characterName).toBe(i === 1 ? 'Fleet Commander 1' : `Fleet Pilot ${i}`);
    }
  });
});
