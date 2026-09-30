import crypto from 'node:crypto';
import type { UserSession } from './types.ts';

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
   * Creates a new user session
   */
  public createSession(sessionData: Omit<UserSession, 'sessionId' | 'createdAt'>): UserSession {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const session: UserSession = {
      ...sessionData,
      sessionId,
      createdAt: Date.now(),
    };
    this.sessions.set(sessionId, session);
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
    expiresAt: number
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.accessToken = accessToken;
    session.refreshToken = refreshToken;
    session.expiresAt = expiresAt;
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
