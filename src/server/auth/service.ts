import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.ts';
import { extractAndValidateCharacterIdentity } from './jwt.ts';
import { SessionStore, defaultSessionStore } from './sessionStore.ts';
import type { AuthConfig, UserSession, EveTokenResponse, PublicSessionInfo } from './types.ts';
import { logger } from '../utils/logger.ts';

export const DEFAULT_SCOPES = [
  'esi-wallet.read_character_wallet.v1',
  'esi-markets.read_character_orders.v1',
  'esi-wallet.read_corporation_wallets.v1',
  'esi-markets.read_corporation_orders.v1',
  'esi-corporations.read_corporation_membership.v1',
  'esi-assets.read_assets.v1',
  'esi-assets.read_corporation_assets.v1',
];

export function getAuthConfigFromEnv(): AuthConfig {
  return {
    clientId: process.env.EVE_CLIENT_ID || '',
    clientSecret: process.env.EVE_CLIENT_SECRET || '',
    callbackUrl: process.env.EVE_CALLBACK_URL || 'http://localhost:3000/api/auth/callback',
    scopes: DEFAULT_SCOPES,
    authBaseUrl: 'https://login.eveonline.com/v2/oauth/authorize',
    tokenBaseUrl: 'https://login.eveonline.com/v2/oauth/token',
  };
}

export class AuthService {
  private customConfig?: Partial<AuthConfig>;
  private sessionStore: SessionStore;
  private fetchFn: typeof fetch;

  constructor(
    config?: Partial<AuthConfig>,
    sessionStore: SessionStore = defaultSessionStore,
    fetchFn: typeof fetch = globalThis.fetch
  ) {
    this.customConfig = config;
    this.sessionStore = sessionStore;
    this.fetchFn = fetchFn;
  }

  public get config(): AuthConfig {
    return { ...getAuthConfigFromEnv(), ...this.customConfig };
  }

  /**
   * Checks if required OAuth credentials are configured
   */
  public isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  /**
   * Generates authorization URL with PKCE and CSRF state
   */
  public createLoginUrl(overrideCallbackUrl?: string, sessionId?: string): { url: string; state: string } {
    if (!this.config.clientId) {
      throw new Error('EVE_CLIENT_ID is not configured in environment variables');
    }

    const callbackUrl = overrideCallbackUrl || this.config.callbackUrl;
    const state = generateState();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // Save pending state with optional existing sessionId
    this.sessionStore.saveOAuthState(state, verifier, sessionId);

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: callbackUrl,
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: state,
    });

    return {
      url: `${this.config.authBaseUrl}?${params.toString()}`,
      state,
    };
  }

  /**
   * Handles OAuth callback: validates state, exchanges code for tokens, creates session or links character
   */
  public async handleCallback(code: string, state: string, existingSessionId?: string): Promise<UserSession> {
    if (!code || !state) {
      throw new Error('Missing code or state in OAuth callback');
    }

    // Validate and consume state
    const stateEntry = this.sessionStore.consumeOAuthState(state);
    if (!stateEntry) {
      throw new Error('Invalid or expired OAuth state parameter (replay protection triggered)');
    }

    const { verifier: codeVerifier, sessionId: stateSessionId } = stateEntry;
    const targetSessionId = existingSessionId || stateSessionId;

    // Exchange authorization code for tokens
    const tokens = await this.exchangeCodeForTokens(code, codeVerifier);

    // Decode & validate character JWT identity
    const identity = extractAndValidateCharacterIdentity(tokens.access_token, this.config.clientId);

    // Expiration timestamp
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    // If an existing valid session is present (from cookie or state), link this character to the session
    if (targetSessionId) {
      const existing = await this.getValidSession(targetSessionId);
      if (existing) {
        const updated = this.sessionStore.addOrUpdateCharacter(
          targetSessionId,
          {
            characterId: identity.characterId,
            characterName: identity.characterName,
            scopes: identity.scopes,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt,
          },
          true
        );
        if (updated) return updated;
      }
    }

    // Create and return session
    return this.sessionStore.createSession({
      characterId: identity.characterId,
      characterName: identity.characterName,
      scopes: identity.scopes,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    });
  }

  /**
   * Exchanges code with CCP token endpoint
   */
  private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<EveTokenResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    };

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      code_verifier: codeVerifier,
    });

    if (this.config.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
    } else {
      bodyParams.set('client_id', this.config.clientId);
    }

    const response = await this.fetchFn(this.config.tokenBaseUrl, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed (HTTP ${response.status}): ${errorText}`);
    }

    return response.json() as Promise<EveTokenResponse>;
  }

  /**
   * Refreshes an expired access token using the session's refresh token
   */
  public async refreshSessionTokens(session: UserSession): Promise<UserSession> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    };

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
    });

    if (this.config.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
    } else {
      bodyParams.set('client_id', this.config.clientId);
    }

    const response = await this.fetchFn(this.config.tokenBaseUrl, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.sessionStore.deleteSession(session.sessionId);
      throw new Error(`Token refresh failed (HTTP ${response.status}): ${errorText}`);
    }

    const tokens: EveTokenResponse = await response.json();
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    this.sessionStore.updateSessionTokens(
      session.sessionId,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt
    );

    return {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
    };
  }

  /**
   * Refreshes tokens for a specific linked character in the session
   */
  public async refreshCharacterTokens(sessionId: string, characterId: number): Promise<string | null> {
    const session = this.sessionStore.getSession(sessionId);
    if (!session || !session.characters || !session.characters[characterId]) return null;

    const char = session.characters[characterId];
    if (!char.refreshToken) return null;

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com',
    };

    const bodyParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: char.refreshToken,
    });

    if (this.config.clientSecret) {
      headers['Authorization'] = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
    } else {
      bodyParams.set('client_id', this.config.clientId);
    }

    const response = await this.fetchFn(this.config.tokenBaseUrl, {
      method: 'POST',
      headers,
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      logger.warn(`[Auth] Token refresh failed for character ${characterId}`);
      return null;
    }

    const tokens: EveTokenResponse = await response.json();
    const expiresAt = Date.now() + tokens.expires_in * 1000;

    this.sessionStore.updateSessionTokens(
      sessionId,
      tokens.access_token,
      tokens.refresh_token,
      expiresAt,
      characterId
    );

    return tokens.access_token;
  }

  /**
   * Retrieves active session, refreshing tokens if close to expiration (< 60 seconds)
   */
  public async getValidSession(sessionId: string): Promise<UserSession | null> {
    if (!sessionId) return null;

    const session = this.sessionStore.getSession(sessionId);
    if (!session) return null;

    // Check if token expires soon (within 60 seconds)
    const isExpiringSoon = Date.now() >= session.expiresAt - 60000;

    if (isExpiringSoon && session.refreshToken) {
      try {
        return await this.refreshSessionTokens(session);
      } catch (err) {
        logger.warn('[Auth] Automatic token refresh failed:', err);
        return null;
      }
    }

    return session;
  }

  /**
   * Generates safe public session representation for UI (no tokens or secrets)
   */
  public getPublicSessionInfo(session: UserSession | null): PublicSessionInfo {
    if (!session) {
      return { authenticated: false };
    }

    const charactersList = session.characters
      ? Object.values(session.characters).map((c) => ({
          characterId: c.characterId,
          characterName: c.characterName,
          portraitUrl: `https://images.evetech.net/characters/${c.characterId}/portrait?size=128`,
          scopes: c.scopes,
          expiresAt: c.expiresAt,
          isActive: c.characterId === (session.activeCharacterId || session.characterId),
        }))
      : [
          {
            characterId: session.characterId,
            characterName: session.characterName,
            portraitUrl: `https://images.evetech.net/characters/${session.characterId}/portrait?size=128`,
            scopes: session.scopes,
            expiresAt: session.expiresAt,
            isActive: true,
          },
        ];

    return {
      authenticated: true,
      character: {
        characterId: session.characterId,
        characterName: session.characterName,
        portraitUrl: `https://images.evetech.net/characters/${session.characterId}/portrait?size=128`,
        scopes: session.scopes,
        expiresAt: session.expiresAt,
      },
      characters: charactersList,
    };
  }

  /**
   * Switches the active character within the user session
   */
  public switchActiveCharacter(sessionId: string, characterId: number): UserSession | null {
    return this.sessionStore.switchActiveCharacter(sessionId, characterId);
  }

  /**
   * Removes a linked character from the session
   */
  public removeCharacter(sessionId: string, characterId: number): UserSession | null {
    return this.sessionStore.removeCharacter(sessionId, characterId);
  }

  /**
   * Logs out user and invalidates session
   */
  public logout(sessionId: string): boolean {
    return this.sessionStore.deleteSession(sessionId);
  }
}
