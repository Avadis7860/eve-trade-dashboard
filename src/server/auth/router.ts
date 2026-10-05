import { Router, type Request, type Response } from 'express';
import { AuthService } from './service.ts';
import { defaultSessionStore } from './sessionStore.ts';
import { logger } from '../utils/logger.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { CharacterAsset } from '../assets/types.ts';

export const SESSION_COOKIE_NAME = 'eve_session_id';

export function extractSessionId(req: Request): string | undefined {
  if (req.cookies?.[SESSION_COOKIE_NAME]) {
    return req.cookies[SESSION_COOKIE_NAME];
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const customHeader = req.headers['x-session-id'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  return undefined;
}

function getCookieOptions(req: Request) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const sameSiteSetting = (process.env.COOKIE_SAMESITE as 'none' | 'lax' | 'strict' | undefined) || (isSecure ? 'lax' : 'lax');
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: sameSiteSetting,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

function getClearCookieOptions(req: Request) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const sameSiteSetting = (process.env.COOKIE_SAMESITE as 'none' | 'lax' | 'strict' | undefined) || (isSecure ? 'lax' : 'lax');
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: sameSiteSetting,
    path: '/',
  };
}

export function createAuthRouter(authService: AuthService = new AuthService()): Router {
  const router = Router();

  /**
   * Status endpoint to check if OAuth credentials are set
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      configured: authService.isConfigured(),
    });
  });

  /**
   * Login endpoint: initiates SSO flow
   */
  router.get('/login', (req: Request, res: Response) => {
    try {
      let overrideCallback: string | undefined;
      // If EVE_CALLBACK_URL is not explicitly set, compute it from request headers
      if (!process.env.EVE_CALLBACK_URL) {
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (host) {
          overrideCallback = `${proto}://${host}/api/auth/callback`;
        }
      }

      const existingSessionId = extractSessionId(req);
      const { url } = authService.createLoginUrl(overrideCallback, existingSessionId);
      if (req.query.format === 'json') {
        res.json({ url });
      } else {
        res.redirect(url);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login initialization failed';
      logger.error('Login initialization error:', message);
      res.status(500).json({ error: message });
    }
  });

  /**
   * Callback endpoint: exchanges OAuth code and establishes session
   */
  router.get('/callback', async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      const errorDesc = (req.query.error_description as string) || error;
      logger.warn('OAuth callback returned error from CCP:', errorDesc);
      res.redirect(`/?auth_error=${encodeURIComponent(errorDesc)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).redirect('/?auth_error=Missing+code+or+state');
      return;
    }

    try {
      const existingSessionId = extractSessionId(req);
      const session = await authService.handleCallback(code, state, existingSessionId);

      res.cookie(SESSION_COOKIE_NAME, session.sessionId, getCookieOptions(req));
      res.redirect(`/?auth=success&session_id=${encodeURIComponent(session.sessionId)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      logger.error('Authentication callback error:', message);
      res.redirect(`/?auth_error=${encodeURIComponent(message)}`);
    }
  });

  /**
   * Session endpoint: returns currently authenticated character and linked characters
   */
  router.get('/session', async (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.json(authService.getPublicSessionInfo(null));
      return;
    }

    const session = await authService.getValidSession(sessionId);
    if (!session) {
      // Clear stale cookie
      res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions(req));
      res.json(authService.getPublicSessionInfo(null));
      return;
    }

    res.json({
      ...authService.getPublicSessionInfo(session),
      sessionId: session.sessionId,
    });
  });

  /**
   * Switch active character endpoint
   */
  router.post('/switch', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    const { characterId } = req.body;
    if (!sessionId || !characterId) {
      res.status(400).json({ error: 'sessionId and characterId are required' });
      return;
    }

    const session = authService.switchActiveCharacter(sessionId, Number(characterId));
    if (!session) {
      res.status(404).json({ error: 'Personnage introuvable dans cette session' });
      return;
    }

    res.json({
      ...authService.getPublicSessionInfo(session),
      sessionId: session.sessionId,
    });
  });

  /**
   * Unlink a character from session
   */
  router.delete('/character/:characterId', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    const characterId = Number(req.params.characterId);
    if (!sessionId || isNaN(characterId)) {
      res.status(400).json({ error: 'characterId valide requis' });
      return;
    }

    const session = authService.removeCharacter(sessionId, characterId);
    if (!session) {
      res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions(req));
      res.json({ authenticated: false, characters: [] });
      return;
    }

    res.json({
      ...authService.getPublicSessionInfo(session),
      sessionId: session.sessionId,
    });
  });

  /**
   * Logout endpoint: invalidates session and clears cookie
   */
  router.post('/logout', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    if (sessionId) {
      authService.logout(sessionId);
    }

    res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions(req));
    res.json({ success: true });
  });

  /**
   * Fleet Keychain Export endpoint: exports all characters in session encrypted with user password
   */
  router.post('/fleet/export', (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    if (!sessionId) {
      res.status(401).json({ error: 'Session non authentifiée' });
      return;
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string' || password.trim().length === 0) {
      res.status(400).json({ error: 'Un mot de passe est obligatoire pour chiffrer le trousseau de flotte' });
      return;
    }

    try {
      const exportResult = authService.exportFleetBackup(sessionId, password);
      res.json({
        success: true,
        filename: 'eve-fleet-backup.enc',
        ...exportResult,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'export du trousseau";
      res.status(400).json({ error: message });
    }
  });

  /**
   * Fleet Keychain Import endpoint: decrypts, validates tokens with CCP, and restores all characters
   */
  router.post('/fleet/import', async (req: Request, res: Response) => {
    const existingSessionId = extractSessionId(req);
    const { encryptedData, password } = req.body || {};

    if (!encryptedData || !password) {
      res.status(400).json({ error: 'Fichier chiffré et mot de passe requis' });
      return;
    }

    try {
      const session = await authService.importFleetBackup(encryptedData, password, existingSessionId);
      res.cookie(SESSION_COOKIE_NAME, session.sessionId, getCookieOptions(req));
      res.json({
        success: true,
        sessionId: session.sessionId,
        restoredCharacters: Object.keys(session.characters || {}).length,
        ...authService.getPublicSessionInfo(session),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Échec de l'import du trousseau";
      logger.warn('[Auth] Fleet import failed:', message);
      res.status(400).json({ error: message });
    }
  });

  /**
   * E2E Test helper endpoints (active in non-production or test environments)
   */
  router.post('/e2e-session', (req: Request, res: Response) => {
    const characterId = Number(req.body?.characterId) || 777001;
    const characterName = req.body?.characterName || 'E2E Fleet Commander';
    const scopes = req.body?.scopes || [
      'publicData',
      'esi-wallet.read_character_wallet.v1',
      'esi-markets.read_character_orders.v1',
      'esi-assets.read_assets.v1',
    ];

    const session = defaultSessionStore.createSession({
      characterId,
      characterName,
      scopes,
      accessToken: 'access-token-e2e',
      refreshToken: 'refresh-token-e2e',
      expiresAt: Date.now() + 86400000,
    });

    res.cookie(SESSION_COOKIE_NAME, session.sessionId, getCookieOptions(req));
    res.json({
      ...authService.getPublicSessionInfo(session),
      sessionId: session.sessionId,
    });
  });

  router.post('/e2e-seed', (_req: Request, res: Response) => {
    const mainCharacterId = 777001;
    const now = Date.now();

    const seededTxs: CharacterTransaction[] = [
      {
        id: `${mainCharacterId}:10001`,
        characterId: mainCharacterId,
        transactionId: 10001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100000,
        unitPrice: 5.0,
        totalValue: 500000,
        isBuy: true,
        isPersonal: true,
        journalRefId: 80001,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        clientId: 4001,
        clientName: 'Supplier Mega Corp',
        date: '2026-09-01T10:00:00Z',
        source: 'esi_sync',
        observedAt: now,
      },
      {
        id: `${mainCharacterId}:10002`,
        characterId: mainCharacterId,
        transactionId: 10002,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 60000,
        unitPrice: 7.0,
        totalValue: 420000,
        isBuy: false,
        isPersonal: true,
        journalRefId: 80002,
        locationId: 60008494,
        locationName: 'Amarr VIII (Oris) - Emperor Family Academy',
        clientId: 4002,
        clientName: 'Consumer Alliance',
        date: '2026-09-15T14:00:00Z',
        source: 'esi_sync',
        observedAt: now,
      },
    ];

    const seededOrders: CharacterOrderSnapshot[] = [
      {
        id: `${mainCharacterId}:20001`,
        characterId: mainCharacterId,
        orderId: 20001,
        typeId: 34,
        typeName: 'Tritanium',
        regionId: 10000002,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        price: 7.2,
        volumeTotal: 40000,
        volumeRemain: 40000,
        volumeFilled: 0,
        isBuyOrder: false,
        duration: 90,
        issued: '2026-09-16T08:00:00Z',
        expiresAt: '2026-12-15T08:00:00Z',
        state: 'ACTIVE',
        stateJustification: 'Actif',
        isActiveInCurrentSnapshot: true,
        firstObservedAt: now,
        lastObservedAt: now,
        lastSnapshotVolumeRemain: 40000,
        source: 'esi_sync',
      },
    ];

    const seededAssets: CharacterAsset[] = [
      {
        id: `${mainCharacterId}:30001`,
        characterId: mainCharacterId,
        itemId: 30001,
        typeId: 34,
        typeName: 'Tritanium',
        quantity: 100000,
        locationId: 60003760,
        locationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        locationType: 'station',
        locationFlag: 'Hangar',
        isSingleton: false,
        isCorpAsset: false,
        source: 'esi_sync',
        observedAt: now,
      },
    ];

    defaultLedgerRepository.saveTransactions(seededTxs);
    defaultOrdersRepository.saveOrderSnapshots(seededOrders);
    defaultAssetsRepository.saveAssets(seededAssets);
    defaultSyncRepository.updateSyncState(mainCharacterId, 'wallet_transactions', {
      status: 'COMPLETE',
      totalRecords: 2,
      lastSyncCompletedAt: now,
    });
    defaultSyncRepository.updateSyncState(mainCharacterId, 'character_orders', {
      status: 'COMPLETE',
      totalRecords: 1,
      lastSyncCompletedAt: now,
    });
    defaultSyncRepository.updateSyncState(mainCharacterId, 'character_assets', {
      status: 'COMPLETE',
      totalRecords: 1,
      lastSyncCompletedAt: now,
    });

    res.json({ success: true, seededTxs: seededTxs.length, seededOrders: seededOrders.length, seededAssets: seededAssets.length });
  });

  router.post('/e2e-reset', (_req: Request, res: Response) => {
    const mainCharacterId = 777001;
    const altCharacterId = 777002;
    defaultLedgerRepository.clearCharacter(mainCharacterId);
    defaultLedgerRepository.clearCharacter(altCharacterId);
    defaultOrdersRepository.clearCharacter(mainCharacterId);
    defaultOrdersRepository.clearCharacter(altCharacterId);
    defaultAssetsRepository.clearAssets(mainCharacterId);
    defaultAssetsRepository.clearAssets(altCharacterId);
    defaultSyncRepository.clearCharacter(mainCharacterId);
    defaultSyncRepository.clearCharacter(altCharacterId);
    res.json({ success: true });
  });

  return router;
}
