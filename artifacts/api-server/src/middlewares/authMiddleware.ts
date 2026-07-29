/**
 * authMiddleware — type declarations + no-op middleware.
 *
 * Runtime auth (session hydration, req.user, req.isAuthenticated) is handled
 * entirely by Passport's `passport.initialize()` + `passport.session()`
 * middleware wired in app.ts.
 *
 * This file is kept to:
 *   1. Merge AuthUser fields into Express.User so the TypeScript type of
 *      req.user throughout the codebase matches the AuthUser shape.
 *   2. Provide the AuthedRequest interface used by route-level type guards.
 *   3. Avoid breaking any existing imports of `authMiddleware`.
 */
import type { AuthUser } from '@workspace/api-zod';
import { type NextFunction, type Request, type Response } from 'express';

declare global {
  namespace Express {
    /**
     * Extends Passport's stub `Express.User` with the concrete AuthUser shape
     * so that `req.user` is fully typed everywhere after authentication.
     */
    interface User extends AuthUser {}

    /**
     * Convenience alias: a Request whose user has been confirmed non-null by
     * `req.isAuthenticated()`. Passport's isAuthenticated() narrows to
     * `AuthenticatedRequest` — AuthedRequest mirrors that for local usage.
     */
    interface AuthedRequest extends Request {
      user: User;
    }
  }
}

/** No-op — Passport middleware in app.ts handles the actual auth work. */
export function authMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next();
}
