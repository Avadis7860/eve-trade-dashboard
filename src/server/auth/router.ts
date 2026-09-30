import { Router, type Request, type Response } from 'express';
import { AuthService } from './service.ts';

const SESSION_COOKIE_NAME = 'eve_session_id';

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

      const { url } = authService.createLoginUrl(overrideCallback);
      if (req.query.format === 'json') {
        res.json({ url });
      } else {
        res.redirect(url);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login initialization failed';
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
      res.redirect(`/?auth_error=${encodeURIComponent(errorDesc)}`);
      return;
    }

    if (!code || !state) {
      res.status(400).redirect('/?auth_error=Missing+code+or+state');
      return;
    }

    try {
      const existingSessionId = req.cookies?.[SESSION_COOKIE_NAME];
      const session = await authService.handleCallback(code, state, existingSessionId);

      res.cookie(SESSION_COOKIE_NAME, session.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.redirect('/?auth=success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      res.redirect(`/?auth_error=${encodeURIComponent(message)}`);
    }
  });

  /**
   * Session endpoint: returns currently authenticated character and linked characters
   */
  router.get('/session', async (req: Request, res: Response) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (!sessionId) {
      res.json(authService.getPublicSessionInfo(null));
      return;
    }

    const session = await authService.getValidSession(sessionId);
    if (!session) {
      // Clear stale cookie
      res.clearCookie(SESSION_COOKIE_NAME);
      res.json(authService.getPublicSessionInfo(null));
      return;
    }

    res.json(authService.getPublicSessionInfo(session));
  });

  /**
   * Switch active character endpoint
   */
  router.post('/switch', (req: Request, res: Response) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
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

    res.json(authService.getPublicSessionInfo(session));
  });

  /**
   * Unlink a character from session
   */
  router.delete('/character/:characterId', (req: Request, res: Response) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    const characterId = Number(req.params.characterId);
    if (!sessionId || isNaN(characterId)) {
      res.status(400).json({ error: 'characterId valide requis' });
      return;
    }

    const session = authService.removeCharacter(sessionId, characterId);
    if (!session) {
      res.clearCookie(SESSION_COOKIE_NAME);
      res.json({ authenticated: false, characters: [] });
      return;
    }

    res.json(authService.getPublicSessionInfo(session));
  });

  /**
   * Logout endpoint: invalidates session and clears cookie
   */
  router.post('/logout', (req: Request, res: Response) => {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) {
      authService.logout(sessionId);
    }

    res.clearCookie(SESSION_COOKIE_NAME);
    res.json({ success: true });
  });

  return router;
}
