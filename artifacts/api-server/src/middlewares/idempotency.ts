/**
 * Idempotency middleware.
 *
 * When a request carries an `Idempotency-Key` header:
 *  - If the key is new: execute the handler, persist the response, return it.
 *  - If the key was seen before with the SAME body hash: replay the cached response (200/201).
 *  - If the key was seen before with a DIFFERENT body hash: return 422 Unprocessable Entity.
 *
 * Storage is the `idempotency_key` table (durable, survives Replit restarts).
 * In-memory caches would lose state on restart and double-process requests.
 */
import { createHash } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "@workspace/db";

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key = req.headers["idempotency-key"] as string | undefined;
  if (!key || key.length > 255) {
    // No key supplied — just continue (idempotency is optional for most routes)
    next();
    return;
  }

  const bodyHash = createHash("sha256")
    .update(JSON.stringify(req.body ?? ""))
    .digest("hex");

  // Resolve the app_user UUID for this OIDC user so we can scope the key
  // to the user (idempotency_key PK is (user_id, key)).
  const replitId = (req as Express.Request).user?.id ?? null;
  let appUserId: string | null = null;
  if (replitId) {
    const ur = await pool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE replit_id = $1`,
      [replitId]
    );
    appUserId = ur.rows[0]?.id ?? null;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query<{
      request_digest: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT request_digest, response_status, response_body
         FROM idempotency_key
        WHERE key = $1 AND ($2::uuid IS NULL OR user_id = $2::uuid)`,
      [key, appUserId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;

      if (row.request_digest !== bodyHash) {
        // Same key, different body — that's a misuse, reject.
        res.status(422).json({
          type: "https://frontoffice.example/probs/422",
          title: "Unprocessable Entity",
          status: 422,
          detail:
            "This Idempotency-Key was previously used with a different request body.",
          trace_id: req.id as string,
        });
        return;
      }

      // Replay the cached response.
      res.status(row.response_status).json(row.response_body);
      return;
    }

    // Intercept the response to capture it for storage.
    const originalJson = res.json.bind(res);
    let capturedStatus = 200;
    let capturedBody: unknown = null;

    res.json = function (body: unknown) {
      capturedStatus = res.statusCode;
      capturedBody = body;
      return originalJson(body);
    };

    // Persist AFTER the response is sent (using `finish` event).
    res.on("finish", () => {
      if (capturedStatus < 500 && capturedBody !== null && appUserId) {
        // Fire-and-forget; errors here are non-fatal.
        pool
          .query(
            `INSERT INTO idempotency_key (user_id, key, request_digest, response_status, response_body, expires_at)
             VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '24 hours')
             ON CONFLICT (user_id, key) DO NOTHING`,
            [appUserId, key, bodyHash, capturedStatus, JSON.stringify(capturedBody)]
          )
          .catch(() => {
            // Swallow — failing to persist an idempotency key is not user-facing.
          });
      }
    });

    next();
  } finally {
    client.release();
  }
}
