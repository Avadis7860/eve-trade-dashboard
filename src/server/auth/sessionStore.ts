import crypto from 'node:crypto';
import type { UserSession, LinkedCharacter } from './types.ts';

export interface PendingOAuthState {
  verifier: string;
  createdAt: number;
}

export class SessionStore {
  private sessions = new Map<string, UserSession>();
  private pendingStates = new Map<string, PendingOAuthState>();
  private readonly STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  /**
   * Stores a one-time OAuth state with its associated PKCE code verifier
   */
  public saveOAuthState(state: string, verifier: string): void {
    this.cleanupExpiredStates();
    this.pendingStates.set(state, {
      verifier,
      createdAt: Date.now(),
    });
  }

  /**
   * Consumes and deletes an OAuth state. Returns verifier or null if invalid/expired.
   */
  public consumeOAuthState(state: string): string | null {
    this.cleanupExpiredStates();
    const entry = this.pendingStates.get(state);
    if (!entry) {
      return null;
    }
    // Delete immediately to prevent replay attacks
    this.pendingStates.delete(state);
    return entry.verifier;
  }

  /**
   * Creates a new user session with primary character and initialized characters map
   */
  public createSession(sessionData: {
    characterId: number;
    characterName: string;
    scopes: string[];
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }): UserSession {
    const sessionId = crypto.randomBytes(32).toString('hex');
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
    return session;
  }

  /**
   * Adds or updates a character in an existing session
   */
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

    return session;
  }

  /**
   * Switches the active character in a session
   */
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
    return session;
  }

  /**
   * Removes a linked character from session
   */
  public removeCharacter(sessionId: string, characterId: number): UserSession | null {
    const session = this.getSession(sessionId);
    if (!session || !session.characters) return null;

    delete session.characters[characterId];
    const remainingIds = Object.keys(session.characters).map(Number);
    if (remainingIds.length === 0) {
      this.deleteSession(sessionId);
      return null;
    }

    if (session.activeCharacterId === characterId) {
      this.switchActiveCharacter(sessionId, remainingIds[0]);
    }
    return session;
  }

  /**
   * Retrieves a session by ID
   */
  public getSession(sessionId: string): UserSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check session max age
    if (Date.now() - session.createdAt > this.SESSION_TTL_MS) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Updates session tokens after a refresh
   */
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
    return true;
  }

  /**
   * Deletes a session (logout)
   */
  public deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Housekeeping for expired states
   */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [state, entry] of this.pendingStates.entries()) {
      if (now - entry.createdAt > this.STATE_TTL_MS) {
        this.pendingStates.delete(state);
      }
    }
  }

  /**
   * Clears all sessions and states (used in test suite)
   */
  public clearAll(): void {
    this.sessions.clear();
    this.pendingStates.clear();
  }
}

export const defaultSessionStore = new SessionStore();
