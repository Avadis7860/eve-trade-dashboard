import { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.ts';
import { extractAndValidateCharacterIdentity } from './jwt.ts';
import { SessionStore, defaultSessionStore } from './sessionStore.ts';
import type { AuthConfig, UserSession, EveTokenResponse, PublicSessionInfo } from './types.ts';
import { encryptWithPassword, decryptWithPassword } from './crypto.ts';
import { logger } from '../utils/logger.ts';

export const DEFAULT_SCOPES = [
  // Portefeuilles, Marchés, Actifs, Contrats & Industrie
  'esi-wallet.read_character_wallet.v1',
  'esi-wallet.read_corporation_wallets.v1',
  'esi-markets.read_character_orders.v1',
  'esi-markets.read_corporation_orders.v1',
  'esi-markets.structure_markets.v1',
  'esi-assets.read_assets.v1',
  'esi-assets.read_corporation_assets.v1',
  'esi-contracts.read_character_contracts.v1',
  'esi-contracts.read_corporation_contracts.v1',
  'esi-industry.read_character_jobs.v1',
  'esi-industry.read_character_mining.v1',
  'esi-industry.read_corporation_jobs.v1',
  'esi-industry.read_corporation_mining.v1',
  // Corporations, Alliances & Structures
  'esi-corporations.read_blueprints.v1',
  'esi-corporations.read_contacts.v1',
  'esi-corporations.read_container_logs.v1',
  'esi-corporations.read_corporation_membership.v1',
  'esi-corporations.read_divisions.v1',
  'esi-corporations.read_facilities.v1',
  'esi-corporations.read_freelance_jobs.v1',
  'esi-corporations.read_fw_stats.v1',
  'esi-corporations.read_medals.v1',
  'esi-corporations.read_projects.v1',
  'esi-corporations.read_standings.v1',
  'esi-corporations.read_starbases.v1',
  'esi-corporations.read_structures.v1',
  'esi-corporations.read_titles.v1',
  'esi-corporations.track_members.v1',
  'esi-alliances.read_contacts.v1',
  'esi-structures.read_character.v1',
  'esi-structures.read_corporation.v1',
  'esi-universe.read_structures.v1',
  'esi-search.search_structures.v1',
  // Personnage, Compétences, Clones, Localisation, Flottes, Courrier & Divers
  'esi-access.read_lists.v1',
  'esi-activities.read_character.v1',
  'esi-calendar.read_calendar_events.v1',
  'esi-calendar.respond_calendar_events.v1',
  'esi-characters.read_agents_research.v1',
  'esi-characters.read_blueprints.v1',
  'esi-characters.read_contacts.v1',
  'esi-characters.read_corporation_roles.v1',
  'esi-characters.read_fatigue.v1',
  'esi-characters.read_freelance_jobs.v1',
  'esi-characters.read_fw_stats.v1',
  'esi-characters.read_loyalty.v1',
  'esi-characters.read_medals.v1',
  'esi-characters.read_notifications.v1',
  'esi-characters.read_standings.v1',
  'esi-characters.read_titles.v1',
  'esi-characters.write_contacts.v1',
  'esi-clones.read_clones.v1',
  'esi-clones.read_implants.v1',
  'esi-fittings.read_fittings.v1',
  'esi-fittings.write_fittings.v1',
  'esi-fleets.read_fleet.v1',
  'esi-fleets.write_fleet.v1',
  'esi-killmails.read_corporation_killmails.v1',
  'esi-killmails.read_killmails.v1',
  'esi-location.read_location.v1',
  'esi-location.read_online.v1',
  'esi-location.read_ship_type.v1',
  'esi-mail.organize_mail.v1',
  'esi-mail.read_mail.v1',
  'esi-mail.send_mail.v1',
  'esi-planets.manage_planets.v1',
  'esi-planets.read_customs_offices.v1',
  'esi-skills.read_skillqueue.v1',
  'esi-skills.read_skills.v1',
  'esi-ui.open_window.v1',
  'esi-ui.write_waypoint.v1',
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
  private inFlightCharacterRefreshes = new Map<number, Promise<string | null>>();
  private inFlightSessionRefreshes = new Map<string, Promise<UserSession>>();
  private inFlightValidSessionRequests = new Map<string, Promise<UserSession | null>>();

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
    if (this.inFlightSessionRefreshes.has(session.sessionId)) {
      return this.inFlightSessionRefreshes.get(session.sessionId)!;
    }

    const refreshPromise = (async () => {
      try {
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
        const newRefreshToken = tokens.refresh_token || session.refreshToken;

        this.sessionStore.updateSessionTokens(
          session.sessionId,
          tokens.access_token,
          newRefreshToken,
          expiresAt
        );

        return {
          ...session,
          accessToken: tokens.access_token,
          refreshToken: newRefreshToken,
          expiresAt,
        };
      } finally {
        this.inFlightSessionRefreshes.delete(session.sessionId);
      }
    })();

    this.inFlightSessionRefreshes.set(session.sessionId, refreshPromise);
    return refreshPromise;
  }

  /**
   * Refreshes tokens for a specific linked character in the session
   */
  public async refreshCharacterTokens(sessionId: string, characterId: number): Promise<string | null> {
    if (this.inFlightCharacterRefreshes.has(characterId)) {
      return this.inFlightCharacterRefreshes.get(characterId)!;
    }

    const refreshPromise = (async () => {
      try {
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
        const newRefreshToken = tokens.refresh_token || char.refreshToken;

        this.sessionStore.updateSessionTokens(
          sessionId,
          tokens.access_token,
          newRefreshToken,
          expiresAt,
          characterId
        );

        return tokens.access_token;
      } finally {
        this.inFlightCharacterRefreshes.delete(characterId);
      }
    })();

    this.inFlightCharacterRefreshes.set(characterId, refreshPromise);
    return refreshPromise;
  }

  /**
   * Refreshes all characters in the session whose access tokens are expiring (< 60s) or expired,
   * with a bounded concurrency pool (max 4 concurrent HTTP requests to CCP).
   */
  public async refreshAllExpiredCharacters(session: UserSession, concurrency: number = 4): Promise<UserSession> {
    const now = Date.now();
    const charactersToRefresh: number[] = [];

    // Collect all characters expiring within 60s
    for (const char of Object.values(session.characters || {})) {
      if (char.expiresAt <= now + 60000 && char.refreshToken) {
        charactersToRefresh.push(char.characterId);
      }
    }

    // Also check primary/active character
    if (session.expiresAt <= now + 60000 && session.refreshToken && !charactersToRefresh.includes(session.activeCharacterId)) {
      charactersToRefresh.push(session.activeCharacterId);
    }

    if (charactersToRefresh.length === 0) {
      return session;
    }

    // Process in bounded chunks of `concurrency`
    for (let i = 0; i < charactersToRefresh.length; i += concurrency) {
      const chunk = charactersToRefresh.slice(i, i + concurrency);
      await Promise.all(
        chunk.map(async (charId) => {
          try {
            await this.refreshCharacterTokens(session.sessionId, charId);
          } catch (err) {
            logger.warn(`[Auth] Auto-refresh failed for character ${charId}: ${(err as Error).message}`);
          }
        })
      );
    }

    const updated = this.sessionStore.getSession(session.sessionId);
    return updated || session;
  }

  /**
   * Retrieves active session, refreshing tokens if close to expiration (< 60 seconds)
   */
  public async getValidSession(sessionId: string): Promise<UserSession | null> {
    if (!sessionId) return null;

    if (this.inFlightValidSessionRequests.has(sessionId)) {
      return this.inFlightValidSessionRequests.get(sessionId)!;
    }

    const validSessionPromise = (async () => {
      try {
        const session = this.sessionStore.getSession(sessionId);
        if (!session) return null;

        const now = Date.now();
        let hasExpiredChar = (session.expiresAt <= now + 60000 && Boolean(session.refreshToken));
        if (!hasExpiredChar && session.characters) {
          for (const char of Object.values(session.characters)) {
            if (char.expiresAt <= now + 60000 && Boolean(char.refreshToken)) {
              hasExpiredChar = true;
              break;
            }
          }
        }

        if (hasExpiredChar) {
          try {
            const refreshed = await this.refreshAllExpiredCharacters(session);
            if (refreshed.expiresAt > now) {
              return refreshed;
            }
            if (refreshed.characters) {
              for (const char of Object.values(refreshed.characters)) {
                if (char.expiresAt > now) {
                  return this.sessionStore.switchActiveCharacter(sessionId, char.characterId);
                }
              }
            }
            return null;
          } catch (err) {
            logger.warn('[Auth] Automatic token refresh failed:', err);
            return null;
          }
        }

        return session;
      } finally {
        this.inFlightValidSessionRequests.delete(sessionId);
      }
    })();

    this.inFlightValidSessionRequests.set(sessionId, validSessionPromise);
    return validSessionPromise;
  }

  /**
   * Exports fleet credentials for all characters in the session, encrypted with the user's password.
   */
  public exportFleetBackup(sessionId: string, password: string): { encryptedData: string; fleetCount: number } {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session introuvable ou non authentifiée');
    }

    const characters = Object.values(session.characters || {});
    if (characters.length === 0) {
      throw new Error('Aucun personnage dans cette session');
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      fleetCount: characters.length,
      characters: characters.map((c) => ({
        characterId: c.characterId,
        characterName: c.characterName,
        refreshToken: c.refreshToken,
        scopes: c.scopes,
      })),
    };

    const encryptedData = encryptWithPassword(JSON.stringify(payload), password);
    return {
      encryptedData,
      fleetCount: characters.length,
    };
  }

  /**
   * Imports a fleet backup encrypted with the user's password.
   * Decrypts, validates every character's refresh token against CCP, and restores the full fleet session.
   */
  public async importFleetBackup(
    encryptedData: string,
    password: string,
    existingSessionId?: string
  ): Promise<UserSession> {
    const jsonStr = decryptWithPassword(encryptedData, password);
    let payload: {
      version: number;
      characters: Array<{
        characterId: number;
        characterName: string;
        refreshToken: string;
        scopes: string[];
      }>;
    };

    try {
      payload = JSON.parse(jsonStr);
    } catch {
      throw new Error('Données de sauvegarde corrompues ou format invalide');
    }

    if (!payload.characters || !Array.isArray(payload.characters) || payload.characters.length === 0) {
      throw new Error('La sauvegarde ne contient aucun personnage valide');
    }

    let targetSessionId = existingSessionId;
    let targetSession = targetSessionId ? this.sessionStore.getSession(targetSessionId) : null;

    const restoredChars: Array<{
      characterId: number;
      characterName: string;
      scopes: string[];
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }> = [];

    for (const char of payload.characters) {
      try {
        const bodyParams = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: char.refreshToken,
        });

        const headers: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Host': 'login.eveonline.com',
        };

        if (this.config.clientSecret) {
          headers['Authorization'] = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
        } else {
          bodyParams.set('client_id', this.config.clientId);
        }

        const res = await this.fetchFn(this.config.tokenBaseUrl, {
          method: 'POST',
          headers,
          body: bodyParams.toString(),
        });

        if (res.ok) {
          const tokens: EveTokenResponse = await res.json();
          restoredChars.push({
            characterId: char.characterId,
            characterName: char.characterName,
            scopes: char.scopes,
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || char.refreshToken,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          });
        } else {
          logger.warn(`[Auth] Failed to validate refresh_token for character ${char.characterName} (#${char.characterId}) during fleet import`);
        }
      } catch (err) {
        logger.warn(`[Auth] Error validating token for character ${char.characterName}: ${(err as Error).message}`);
      }
    }

    if (restoredChars.length === 0) {
      throw new Error("Aucun jeton de la flotte n'a pu être validé auprès de CCP (tous révoqués ou invalides)");
    }

    const firstChar = restoredChars[0];

    if (!targetSession) {
      targetSession = this.sessionStore.createSession({
        characterId: firstChar.characterId,
        characterName: firstChar.characterName,
        scopes: firstChar.scopes,
        accessToken: firstChar.accessToken,
        refreshToken: firstChar.refreshToken,
        expiresAt: firstChar.expiresAt,
        sessionId: targetSessionId,
      });
      targetSessionId = targetSession.sessionId;
    }

    for (const char of restoredChars) {
      this.sessionStore.addOrUpdateCharacter(
        targetSessionId!,
        char,
        char.characterId === firstChar.characterId
      );
    }

    const finalSession = this.sessionStore.getSession(targetSessionId!);
    if (!finalSession) {
      throw new Error('Échec de la restauration de la session');
    }

    return finalSession;
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
