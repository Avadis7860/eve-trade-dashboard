import crypto from 'node:crypto';
import type { UserSession, LinkedCharacter } from './types.ts';
import {
  StorageManager,
  DurableFileDatabaseAdapter,
  PostgresDatabaseAdapter,
  type StoredDurableCharacter,
} from '../storage/database.ts';
import type { IDatabaseAdapter } from '../storage/types.ts';
import { encryptToken, decryptToken } from './crypto.ts';
import { logger } from '../utils/logger.ts';

export interface PendingOAuthState {
  verifier: string;
  createdAt: number;
  sessionId?: string;
}

export class SessionStore {
  private sessions = new Map<string, UserSession>();
  private pendingStates = new Map<string, PendingOAuthState>();
  private readonly STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  constructor(private adapter: IDatabaseAdapter = StorageManager.getInstance().getAdapter()) {
    this.loadFromStorageSync();
  }

  /**
   * Synchronously loads sessions from DurableFileDatabaseAdapter if used
   */
  public loadFromStorageSync(): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state?.sessions) {
        for (const [sessionId, storedSess] of Object.entries(state.sessions)) {
          if (Date.now() - storedSess.createdAt > this.SESSION_TTL_MS) {
            continue;
          }
          const characters: Record<number, LinkedCharacter> = {};
          for (const [charIdStr, storedChar] of Object.entries(storedSess.characters || {})) {
            const charId = Number(charIdStr);
            try {
              characters[charId] = {
                characterId: storedChar.characterId,
                characterName: storedChar.characterName,
                scopes: storedChar.scopes || [],
                accessToken: decryptToken(storedChar.encryptedAccessToken),
                refreshToken: decryptToken(storedChar.encryptedRefreshToken),
                expiresAt: storedChar.expiresAt,
                createdAt: storedChar.createdAt,
              };
            } catch (err) {
              logger.warn(`[SessionStore] Could not decrypt tokens for char ${charId} in session ${sessionId}: ${(err as Error).message}`);
            }
          }

          const activeChar = characters[storedSess.activeCharacterId] || Object.values(characters)[0];
          if (activeChar) {
            const userSession: UserSession = {
              sessionId: storedSess.sessionId,
              activeCharacterId: activeChar.characterId,
              characterId: activeChar.characterId,
              characterName: activeChar.characterName,
              scopes: activeChar.scopes,
              accessToken: activeChar.accessToken,
              refreshToken: activeChar.refreshToken,
              expiresAt: activeChar.expiresAt,
              createdAt: storedSess.createdAt,
              characters,
            };
            this.sessions.set(sessionId, userSession);
          }
        }
      }
    }
  }

  /**
   * Asynchronously initializes/reloads sessions from database (supports Postgres and File)
   */
  public async init(): Promise<void> {
    if (this.adapter instanceof PostgresDatabaseAdapter) {
      try {
        const sessRes = await this.adapter.query<{
          session_id: string;
          active_character_id: string;
          created_at: string;
          updated_at: string;
        }>('SELECT session_id, active_character_id, created_at, updated_at FROM sessions');

        const charsRes = await this.adapter.query<{
          id: string;
          session_id: string;
          character_id: string;
          character_name: string;
          scopes: string;
          encrypted_refresh_token: string;
          encrypted_access_token: string;
          expires_at: string;
          created_at: string;
        }>('SELECT id, session_id, character_id, character_name, scopes, encrypted_refresh_token, encrypted_access_token, expires_at, created_at FROM session_characters');

        const charsBySession = new Map<string, Record<number, LinkedCharacter>>();
        for (const row of charsRes.rows) {
          const sessId = row.session_id;
          const charId = Number(row.character_id);
          if (!charsBySession.has(sessId)) {
            charsBySession.set(sessId, {});
          }
          let parsedScopes: string[] = [];
          try {
            parsedScopes = JSON.parse(row.scopes);
          } catch {
            parsedScopes = row.scopes ? row.scopes.split(' ') : [];
          }

          try {
            charsBySession.get(sessId)![charId] = {
              characterId: charId,
              characterName: row.character_name,
              scopes: parsedScopes,
              accessToken: decryptToken(row.encrypted_access_token),
              refreshToken: decryptToken(row.encrypted_refresh_token),
              expiresAt: Number(row.expires_at),
              createdAt: Number(row.created_at),
            };
          } catch (err) {
            logger.warn(`[SessionStore] Failed to decrypt Postgres tokens for char ${charId}: ${(err as Error).message}`);
          }
        }

        for (const sRow of sessRes.rows) {
          const createdAt = Number(sRow.created_at);
          if (Date.now() - createdAt > this.SESSION_TTL_MS) continue;

          const characters = charsBySession.get(sRow.session_id) || {};
          const activeCharId = Number(sRow.active_character_id);
          const activeChar = characters[activeCharId] || Object.values(characters)[0];
          if (activeChar) {
            this.sessions.set(sRow.session_id, {
              sessionId: sRow.session_id,
              activeCharacterId: activeChar.characterId,
              characterId: activeChar.characterId,
              characterName: activeChar.characterName,
              scopes: activeChar.scopes,
              accessToken: activeChar.accessToken,
              refreshToken: activeChar.refreshToken,
              expiresAt: activeChar.expiresAt,
              createdAt,
              characters,
            });
          }
        }
      } catch (err) {
        logger.error(`[SessionStore] Error initializing sessions from Postgres: ${(err as Error).message}`);
      }
    } else {
      this.loadFromStorageSync();
    }
  }

  private saveSessionToStorage(session: UserSession): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (!state.sessions) {
        state.sessions = {};
      }
      const storedChars: Record<number, StoredDurableCharacter> = {};
      for (const [charIdStr, char] of Object.entries(session.characters || {})) {
        const charId = Number(charIdStr);
        storedChars[charId] = {
          characterId: char.characterId,
          characterName: char.characterName,
          scopes: char.scopes,
          encryptedRefreshToken: encryptToken(char.refreshToken),
          encryptedAccessToken: encryptToken(char.accessToken),
          expiresAt: char.expiresAt,
          createdAt: char.createdAt,
        };
      }
      state.sessions[session.sessionId] = {
        sessionId: session.sessionId,
        activeCharacterId: session.activeCharacterId,
        createdAt: session.createdAt,
        updatedAt: Date.now(),
        characters: storedChars,
      };
      this.adapter.persist();
    } else if (this.adapter instanceof PostgresDatabaseAdapter) {
      (async () => {
        try {
          await this.adapter.execute(
            `INSERT INTO sessions (session_id, active_character_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (session_id) DO UPDATE SET
               active_character_id = EXCLUDED.active_character_id,
               updated_at = EXCLUDED.updated_at`,
            [session.sessionId, session.activeCharacterId, session.createdAt, Date.now()]
          );
          for (const char of Object.values(session.characters || {})) {
            const rowId = `${session.sessionId}:${char.characterId}`;
            await this.adapter.execute(
              `INSERT INTO session_characters (
                 id, session_id, character_id, character_name, scopes,
                 encrypted_refresh_token, encrypted_access_token, expires_at, created_at
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (id) DO UPDATE SET
                 character_name = EXCLUDED.character_name,
                 scopes = EXCLUDED.scopes,
                 encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
                 encrypted_access_token = EXCLUDED.encrypted_access_token,
                 expires_at = EXCLUDED.expires_at`,
              [
                rowId,
                session.sessionId,
                char.characterId,
                char.characterName,
                JSON.stringify(char.scopes),
                encryptToken(char.refreshToken),
                encryptToken(char.accessToken),
                char.expiresAt,
                char.createdAt,
              ]
            );
          }
        } catch (err) {
          logger.error(`[SessionStore] Failed to persist session to Postgres: ${(err as Error).message}`);
        }
      })();
    }
  }

  private deleteSessionFromStorage(sessionId: string): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state.sessions && state.sessions[sessionId]) {
        delete state.sessions[sessionId];
        this.adapter.persist();
      }
    } else if (this.adapter instanceof PostgresDatabaseAdapter) {
      (async () => {
        try {
          await this.adapter.execute('DELETE FROM sessions WHERE session_id = $1', [sessionId]);
        } catch (err) {
          logger.error(`[SessionStore] Failed to delete session from Postgres: ${(err as Error).message}`);
        }
      })();
    }
  }

  private removeCharacterFromStorage(sessionId: string, characterId: number): void {
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      if (state.sessions && state.sessions[sessionId]?.characters[characterId]) {
        delete state.sessions[sessionId].characters[characterId];
        this.adapter.persist();
      }
    } else if (this.adapter instanceof PostgresDatabaseAdapter) {
      (async () => {
        try {
          await this.adapter.execute(
            'DELETE FROM session_characters WHERE session_id = $1 AND character_id = $2',
            [sessionId, characterId]
          );
        } catch (err) {
          logger.error(`[SessionStore] Failed to delete character from Postgres: ${(err as Error).message}`);
        }
      })();
    }
  }

  public saveOAuthState(state: string, verifier: string, sessionId?: string): void {
    this.cleanupExpiredStates();
    this.pendingStates.set(state, {
      verifier,
      sessionId,
      createdAt: Date.now(),
    });
  }

  public consumeOAuthState(state: string): { verifier: string; sessionId?: string } | null {
    this.cleanupExpiredStates();
    const entry = this.pendingStates.get(state);
    if (!entry) {
      return null;
    }
    this.pendingStates.delete(state);
    return { verifier: entry.verifier, sessionId: entry.sessionId };
  }

  public createSession(sessionData: {
    characterId: number;
    characterName: string;
    scopes: string[];
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    sessionId?: string;
  }): UserSession {
    const sessionId = sessionData.sessionId || crypto.randomBytes(32).toString('hex');
    const linkedChar: LinkedCharacter = {
      characterId: sessionData.characterId,
      characterName: sessionData.characterName,
      scopes: sessionData.scopes,
      accessToken: sessionData.accessToken,
      refreshToken: sessionData.refreshToken,
      expiresAt: sessionData.expiresAt,
      createdAt: Date.now(),
    };

    const session: UserSession = {
      sessionId,
      activeCharacterId: sessionData.characterId,
      characterId: sessionData.characterId,
      characterName: sessionData.characterName,
      scopes: sessionData.scopes,
      accessToken: sessionData.accessToken,
      refreshToken: sessionData.refreshToken,
      expiresAt: sessionData.expiresAt,
      characters: {
        [sessionData.characterId]: linkedChar,
      },
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
    this.saveSessionToStorage(session);
    return session;
  }

  public addOrUpdateCharacter(
    sessionId: string,
    charData: {
      characterId: number;
      characterName: string;
      scopes: string[];
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    },
    makeActive: boolean = true
  ): UserSession | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    if (!session.characters) {
      session.characters = {};
    }

    session.characters[charData.characterId] = {
      characterId: charData.characterId,
      characterName: charData.characterName,
      scopes: charData.scopes,
      accessToken: charData.accessToken,
      refreshToken: charData.refreshToken,
      expiresAt: charData.expiresAt,
      createdAt: session.characters[charData.characterId]?.createdAt || Date.now(),
    };

    if (makeActive || session.activeCharacterId === charData.characterId) {
      session.activeCharacterId = charData.characterId;
      session.characterId = charData.characterId;
      session.characterName = charData.characterName;
      session.scopes = charData.scopes;
      session.accessToken = charData.accessToken;
      session.refreshToken = charData.refreshToken;
      session.expiresAt = charData.expiresAt;
    }

    this.saveSessionToStorage(session);
    return session;
  }

  public switchActiveCharacter(sessionId: string, characterId: number): UserSession | null {
    const session = this.getSession(sessionId);
    if (!session || !session.characters || !session.characters[characterId]) {
      return null;
    }

    const char = session.characters[characterId];
    session.activeCharacterId = characterId;
    session.characterId = characterId;
    session.characterName = char.characterName;
    session.scopes = char.scopes;
    session.accessToken = char.accessToken;
    session.refreshToken = char.refreshToken;
    session.expiresAt = char.expiresAt;

    this.saveSessionToStorage(session);
    return session;
  }

  public removeCharacter(sessionId: string, characterId: number): UserSession | null {
    const session = this.getSession(sessionId);
    if (!session || !session.characters) return null;

    delete session.characters[characterId];
    this.removeCharacterFromStorage(sessionId, characterId);

    const remainingIds = Object.keys(session.characters).map(Number);
    if (remainingIds.length === 0) {
      this.deleteSession(sessionId);
      return null;
    }

    if (session.activeCharacterId === characterId) {
      this.switchActiveCharacter(sessionId, remainingIds[0]);
    } else {
      this.saveSessionToStorage(session);
    }
    return session;
  }

  public getSession(sessionId: string): UserSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (Date.now() - session.createdAt > this.SESSION_TTL_MS) {
      this.deleteSession(sessionId);
      return null;
    }

    return session;
  }

  public getAllSessions(): UserSession[] {
    return Array.from(this.sessions.values());
  }

  public updateSessionTokens(
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt: number,
    characterId?: number
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    const targetCharId = characterId || session.activeCharacterId || session.characterId;
    if (session.characters && session.characters[targetCharId]) {
      session.characters[targetCharId].accessToken = accessToken;
      session.characters[targetCharId].refreshToken = refreshToken;
      session.characters[targetCharId].expiresAt = expiresAt;
    }

    if (session.activeCharacterId === targetCharId || session.characterId === targetCharId) {
      session.accessToken = accessToken;
      session.refreshToken = refreshToken;
      session.expiresAt = expiresAt;
    }

    this.saveSessionToStorage(session);
    return true;
  }

  public deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    this.deleteSessionFromStorage(sessionId);
    return existed;
  }

  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, entry] of this.pendingStates.entries()) {
      if (now - entry.createdAt > this.STATE_TTL_MS) {
        this.pendingStates.delete(state);
      }
    }
  }

  public clearAll(): void {
    this.sessions.clear();
    this.pendingStates.clear();
    if (this.adapter instanceof DurableFileDatabaseAdapter) {
      const state = this.adapter.getState();
      state.sessions = {};
      this.adapter.persist();
    }
  }
}

export const defaultSessionStore = new SessionStore();
