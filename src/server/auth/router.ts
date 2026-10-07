import { Router, type Request, type Response } from 'express';
import { AuthService } from './service.ts';
import { SessionStore, defaultSessionStore } from './sessionStore.ts';
import { logger } from '../utils/logger.ts';
import { defaultLedgerRepository } from '../ledger/repository.ts';
import { defaultOrdersRepository } from '../orders/repository.ts';
import { defaultAssetsRepository } from '../assets/repository.ts';
import { defaultSyncRepository } from '../sync/repository.ts';
import type { CharacterTransaction } from '../ledger/types.ts';
import type { CharacterOrderSnapshot } from '../orders/types.ts';
import type { CharacterAsset } from '../assets/types.ts';
import type { UserSession, LinkedCharacter } from './types.ts';

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
  const sameSiteSetting = (process.env.COOKIE_SAMESITE as 'none' | 'lax' | 'strict' | undefined) || (isSecure ? 'none' : 'lax');
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
  const sameSiteSetting = (process.env.COOKIE_SAMESITE as 'none' | 'lax' | 'strict' | undefined) || (isSecure ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: sameSiteSetting,
    path: '/',
  };
}

export function createAuthRouter(
  authService: AuthService = new AuthService(),
  sessionStore?: SessionStore
): Router {
  const router = Router();
  const store = sessionStore || (typeof authService.getSessionStore === 'function' ? authService.getSessionStore() : defaultSessionStore);

  const getSavedSessionsList = () => {
    const allSessions = (store.getAllSessions() as UserSession[]).sort(
      (a: UserSession, b: UserSession) => (b.createdAt || 0) - (a.createdAt || 0)
    );
    return allSessions
      .map((s: UserSession) => {
        const charList: LinkedCharacter[] = Object.values(s.characters || {});
        const activeChar = (s.activeCharacterId && s.characters?.[s.activeCharacterId]) || charList[0];
        const activeId = activeChar?.characterId || s.activeCharacterId || s.characterId;
        const activeName = activeChar?.characterName || s.characterName;
        return {
          sessionId: s.sessionId,
          activeCharacterId: activeId,
          activeCharacterName: activeName,
          portraitUrl: `https://images.evetech.net/characters/${activeId}/portrait?size=128`,
          charactersCount: charList.length,
          characterNames: charList.map((c: LinkedCharacter) => c.characterName),
          createdAt: s.createdAt,
        };
      })
      .filter((s) => s.charactersCount > 0);
  };

  /**
   * Status endpoint to check if OAuth credentials are set
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      configured: authService.isConfigured(),
    });
  });

  /**
   * Saved sessions discovery endpoint: returns non-sensitive metadata for persisted sessions
   */
  router.get('/saved-sessions', (_req: Request, res: Response) => {
    try {
      res.json({ savedSessions: getSavedSessionsList() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to retrieve saved sessions';
      logger.error('[Auth] Error getting saved sessions:', message);
      res.status(500).json({ error: message, savedSessions: [] });
    }
  });

  /**
   * Resume endpoint: restores an existing saved session without re-authenticating through SSO
   */
  router.post('/resume', async (req: Request, res: Response) => {
    try {
      let targetSessionId = (req.body?.sessionId as string | undefined)?.trim();

      if (!targetSessionId) {
        const saved = getSavedSessionsList();
        if (saved.length > 0) {
          targetSessionId = saved[0].sessionId;
        }
      }

      if (!targetSessionId) {
        res.status(404).json({ error: 'Aucune session sauvegardée disponible' });
        return;
      }

      const validSession = await authService.getValidSession(targetSessionId);
      if (!validSession) {
        res.status(404).json({ error: 'La session sauvegardée a expiré ou est invalide' });
        return;
      }

      res.cookie(SESSION_COOKIE_NAME, validSession.sessionId, getCookieOptions(req));
      res.json({
        success: true,
        ...authService.getPublicSessionInfo(validSession),
        sessionId: validSession.sessionId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resume session';
      logger.error('[Auth] Error resuming session:', message);
      res.status(500).json({ error: message });
    }
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

      let existingSessionId = extractSessionId(req);
      if (!existingSessionId && typeof req.query.session_id === 'string' && req.query.session_id.trim()) {
        existingSessionId = req.query.session_id.trim();
      }

      const { url } = authService.createLoginUrl(overrideCallback, existingSessionId);
      if (req.query.format === 'json') {
        res.json({ url });
      } else {
        // Safe bridge: if opened inside an iframe, prevent browser "login.eveonline.com refused to connect" error
        res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Connexion EVE Online SSO</title>
  </head>
  <body style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 16px; box-sizing: border-box;">
    <div style="max-width: 460px; text-align: center; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; border-radius: 12px; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; font-weight: bold; font-size: 20px; margin-bottom: 16px;">Ω</div>
      <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">Connexion EVE Online (SSO)</h2>
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0 0 24px 0;">
        CCP interdit l'affichage de sa mire de connexion dans les cadres (iframes). Ouvrez la page d'authentification officielle ci-dessous.
      </p>
      <a id="authLink" href="${url}" target="_blank" rel="noopener noreferrer" style="display: block; width: 100%; box-sizing: border-box; padding: 12px 20px; background: #f59e0b; color: #020617; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; transition: background 0.2s;">
        Ouvrir la connexion CCP EVE Online &rarr;
      </a>
      <p style="color: #64748b; font-size: 11px; margin-top: 16px; margin-bottom: 0;">
        Une fois validé sur le site officiel de CCP, votre tableau de bord s'actualisera automatiquement.
      </p>
    </div>
    <script>
      try {
        if (window.self !== window.top) {
          // If in iframe, attempt opening popup or user click
          var popup = window.open('${url}', 'eve_sso_auth', 'width=620,height=750,status=no,toolbar=no,menubar=no');
          if (popup) {
            document.getElementById('authLink').innerText = 'Fenêtre ouverte — Cliquez ici si bloquée';
          }
        } else {
          window.location.href = '${url}';
        }
      } catch (e) {
        window.location.href = '${url}';
      }
    </script>
  </body>
</html>`);
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
      res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Erreur EVE SSO</title></head>
  <body style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 16px;">
    <div style="max-width: 420px; text-align: center; background: #0f172a; border: 1px solid #7f1d1d; border-radius: 16px; padding: 28px;">
      <h3 style="color: #ef4444; margin: 0 0 8px 0;">Erreur d'authentification EVE SSO</h3>
      <p style="color: #cbd5e1; font-size: 13px;">${encodeURIComponent(errorDesc)}</p>
      <script>
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'EVE_AUTH_ERROR', error: '${errorDesc.replace(/'/g, "\\'")}' }, '*');
          setTimeout(function() { window.close(); }, 1500);
        } else {
          window.location.href = '/?auth_error=${encodeURIComponent(errorDesc)}';
        }
      </script>
    </div>
  </body>
</html>`);
      return;
    }

    if (!code || !state) {
      res.status(400).send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Erreur EVE SSO</title></head>
  <body style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; padding: 24px; text-align: center;">
    <p style="color: #ef4444;">Paramètres de code ou d'état manquants dans la réponse de CCP.</p>
  </body>
</html>`);
      return;
    }

    try {
      const existingSessionId = extractSessionId(req);
      const session = await authService.handleCallback(code, state, existingSessionId);

      res.cookie(SESSION_COOKIE_NAME, session.sessionId, getCookieOptions(req));

      const redirectTarget = `/?auth=success&session_id=${encodeURIComponent(session.sessionId)}`;
      res.send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>EVE Online SSO - Authentification réussie</title>
  </head>
  <body style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 16px;">
    <div style="max-width: 440px; text-align: center; background: #0f172a; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
      <div style="display: inline-block; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #10b981; font-weight: bold; font-size: 18px; margin-bottom: 16px;">&#10003;</div>
      <h2 style="color: #ffffff; margin: 0 0 8px 0; font-size: 20px;">Authentification Réussie</h2>
      <p style="color: #94a3b8; font-size: 13px; margin: 0 0 20px 0;">
        Connexion validée auprès de CCP EVE Online. Cette fenêtre se ferme automatiquement...
      </p>
      <a href="${redirectTarget}" style="display: inline-block; padding: 10px 20px; background: #f59e0b; color: #020617; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 13px;">
        Revenir au Tableau de Bord &rarr;
      </a>
    </div>
    <script>
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type: 'EVE_AUTH_SUCCESS',
            sessionId: '${session.sessionId}'
          }, '*');
          setTimeout(function() {
            window.close();
          }, 300);
        } else {
          window.location.href = '${redirectTarget}';
        }
      } catch (e) {
        window.location.href = '${redirectTarget}';
      }
    </script>
  </body>
</html>`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      logger.error('Authentication callback error:', message);
      res.send(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Erreur EVE SSO</title></head>
  <body style="font-family: system-ui, sans-serif; background: #020617; color: #f8fafc; padding: 24px; text-align: center;">
    <h3 style="color: #ef4444;">Échec de l'authentification</h3>
    <p style="color: #94a3b8; font-size: 13px;">${encodeURIComponent(message)}</p>
    <script>
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'EVE_AUTH_ERROR', error: '${message.replace(/'/g, "\\'")}' }, '*');
        setTimeout(function() { window.close(); }, 2000);
      } else {
        window.location.href = '/?auth_error=${encodeURIComponent(message)}';
      }
    </script>
  </body>
</html>`);
    }
  });

  /**
   * Session endpoint: returns currently authenticated character and linked characters
   */
  router.get('/session', async (req: Request, res: Response) => {
    const sessionId = extractSessionId(req);
    const savedSessions = getSavedSessionsList();

    if (!sessionId) {
      const autoResume = req.query.auto_resume === 'true' || req.query.auto_resume === '1';
      if (autoResume && savedSessions.length > 0) {
        const resumed = await authService.getValidSession(savedSessions[0].sessionId);
        if (resumed) {
          res.cookie(SESSION_COOKIE_NAME, resumed.sessionId, getCookieOptions(req));
          res.json({
            ...authService.getPublicSessionInfo(resumed),
            sessionId: resumed.sessionId,
            savedSessions,
          });
          return;
        }
      }

      res.json({
        ...authService.getPublicSessionInfo(null),
        savedSessions,
      });
      return;
    }

    const session = await authService.getValidSession(sessionId);
    if (!session) {
      // Clear stale cookie
      res.clearCookie(SESSION_COOKIE_NAME, getClearCookieOptions(req));
      res.json({
        ...authService.getPublicSessionInfo(null),
        savedSessions,
      });
      return;
    }

    res.json({
      ...authService.getPublicSessionInfo(session),
      sessionId: session.sessionId,
      savedSessions,
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
   * E2E Test helper endpoints (strictly disabled in production mode)
   */
  if (process.env.NODE_ENV !== 'production') {
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
  }

  return router;
}
