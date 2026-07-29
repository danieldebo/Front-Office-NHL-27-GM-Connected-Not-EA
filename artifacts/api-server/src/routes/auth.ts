/**
 * Auth routes — multi-provider (Google, Microsoft, Discord, local).
 *
 * Endpoints:
 *   GET  /auth/user                  → current authenticated user (or null)
 *   POST /auth/login                 → local email+password login
 *   POST /auth/register              → create local account + auto-login
 *   GET  /auth/google                → initiate Google OAuth
 *   GET  /auth/google/callback       → Google OAuth callback
 *   GET  /auth/microsoft             → initiate Microsoft OAuth
 *   GET  /auth/microsoft/callback    → Microsoft OAuth callback
 *   GET  /auth/discord               → initiate Discord OAuth
 *   GET  /auth/discord/callback      → Discord OAuth callback
 *   GET  /login                      → backward-compat entry; picks first
 *                                       configured provider (preserves returnTo)
 *   GET  /logout                     → clear session + redirect to /
 */
import { GetCurrentAuthUserResponse } from '@workspace/api-zod';
import { db, usersTable, authAccountsTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import bcrypt from 'bcryptjs';
import { passport, provisionAppUser } from '../lib/passport';

// Allow session to carry a validated returnTo destination between the
// login initiation and the OAuth callback redirect.
declare module 'express-session' {
  interface SessionData {
    returnTo?: string;
  }
}

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a returnTo value is a safe relative path (starts with /,
 * not //).  Prevents open-redirect attacks from attacker-supplied values.
 */
function safeReturnTo(value: unknown, fallback = '/'): string {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) {
    return value;
  }
  return fallback;
}

/**
 * After a successful OAuth callback, redirect the user to wherever they
 * were trying to go before login (stored in session as returnTo), then
 * clear it so subsequent logins start clean.
 */
function redirectAfterLogin(req: Request, res: Response): void {
  const dest = safeReturnTo(req.session.returnTo);
  delete req.session.returnTo;
  res.redirect(dest);
}

// ---------------------------------------------------------------------------
// GET /auth/user
// ---------------------------------------------------------------------------

router.get('/auth/user', (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

// ---------------------------------------------------------------------------
// POST /auth/login  (local email+password)
// ---------------------------------------------------------------------------

router.post(
  '/auth/login',
  (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(
      'local',
      (err: Error | null, user: Express.User | false) => {
        if (err) {
          req.log?.error({ err }, 'local auth error');
          res.status(500).json({ error: 'Authentication error' });
          return;
        }
        if (!user) {
          res.status(401).json({ error: 'Invalid email or password' });
          return;
        }
        req.login(user, (loginErr) => {
          if (loginErr) {
            req.log?.error({ err: loginErr }, 'session error after login');
            res.status(500).json({ error: 'Session error' });
            return;
          }
          res.json(GetCurrentAuthUserResponse.parse({ user: req.user }));
        });
      },
    )(req, res, next);
  },
);

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

router.post('/auth/register', async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body ?? {};

  if (
    !email ||
    typeof email !== 'string' ||
    !password ||
    typeof password !== 'string'
  ) {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (existing) {
    res.status(409).json({ error: 'An account with that email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      firstName: typeof firstName === 'string' ? firstName : null,
      lastName: typeof lastName === 'string' ? lastName : null,
    })
    .returning();

  await db.insert(authAccountsTable).values({
    userId: user.id,
    provider: 'local',
    passwordHash,
  });

  await provisionAppUser(user);

  req.login(user, (err) => {
    if (err) {
      req.log?.error({ err }, 'session error after registration');
      res.status(500).json({ error: 'Session error after registration' });
      return;
    }
    res.status(201).json(GetCurrentAuthUserResponse.parse({ user: req.user }));
  });
});

// ---------------------------------------------------------------------------
// GET /login  —  backward-compat bridge
//
// useAuth.login() and legacy hrefs call /api/login?returnTo=...
// Until Task #26 ships a multi-provider picker UI we redirect to the
// first configured OAuth provider (or the frontend /login page for
// email+password when no OAuth is configured).
// returnTo is stored in the session so it survives the OAuth round-trip.
// ---------------------------------------------------------------------------

const OAUTH_PROVIDERS: Array<{
  envKey: string;
  path: string;
}> = [
  { envKey: 'GOOGLE_CLIENT_ID', path: '/api/auth/google' },
  { envKey: 'MICROSOFT_CLIENT_ID', path: '/api/auth/microsoft' },
  { envKey: 'DISCORD_CLIENT_ID', path: '/api/auth/discord' },
];

router.get('/login', (req: Request, res: Response) => {
  // Persist a validated returnTo so OAuth callbacks can restore it
  const returnTo = safeReturnTo(req.query.returnTo);
  if (returnTo !== '/') {
    req.session.returnTo = returnTo;
  }

  // Pick the first provider that has credentials configured
  const provider = OAUTH_PROVIDERS.find((p) => process.env[p.envKey]);
  if (provider) {
    res.redirect(provider.path);
  } else {
    // No OAuth providers configured — send to the frontend login page
    // which will offer the email+password form (Task #26)
    res.redirect('/login');
  }
});

// ---------------------------------------------------------------------------
// Strategy guard middleware
//
// Passport throws "Unknown authentication strategy" if .authenticate() is
// called for a strategy that was never registered (i.e. env vars absent).
// This guard returns a deterministic 503 before Passport is reached so the
// caller gets a clear message instead of an uncaught exception.
// ---------------------------------------------------------------------------

// Map of provider name → [clientIdKey, clientSecretKey] pairs.
// Both must be non-empty for the Passport strategy to have been registered.
const PROVIDER_ENV_KEYS: Record<string, [string, string]> = {
  Google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  Microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  Discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
};

function requireProvider(label: string) {
  const [idKey, secretKey] = PROVIDER_ENV_KEYS[label]!;
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!process.env[idKey] || !process.env[secretKey]) {
      res
        .status(503)
        .json({ error: `${label} sign-in is not configured on this server` });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

router.get(
  '/auth/google',
  requireProvider('Google'),
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

router.get(
  '/auth/google/callback',
  requireProvider('Google'),
  passport.authenticate('google', { failureRedirect: '/?auth=failed' }),
  (req: Request, res: Response) => redirectAfterLogin(req, res),
);

// ---------------------------------------------------------------------------
// Microsoft
// ---------------------------------------------------------------------------

router.get(
  '/auth/microsoft',
  requireProvider('Microsoft'),
  passport.authenticate('microsoft', { scope: ['user.read'] }),
);

router.get(
  '/auth/microsoft/callback',
  requireProvider('Microsoft'),
  passport.authenticate('microsoft', { failureRedirect: '/?auth=failed' }),
  (req: Request, res: Response) => redirectAfterLogin(req, res),
);

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

router.get(
  '/auth/discord',
  requireProvider('Discord'),
  passport.authenticate('discord'),
);

router.get(
  '/auth/discord/callback',
  requireProvider('Discord'),
  passport.authenticate('discord', { failureRedirect: '/?auth=failed' }),
  (req: Request, res: Response) => redirectAfterLogin(req, res),
);

// ---------------------------------------------------------------------------
// GET /logout
// ---------------------------------------------------------------------------

router.get('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) req.log?.warn({ err }, 'logout error');
    res.redirect('/');
  });
});

export default router;
