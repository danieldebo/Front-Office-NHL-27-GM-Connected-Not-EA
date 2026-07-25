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

  const client = await pool.connect();
  try {
    const existing = await client.query<{
      body_hash: string;
      response_status: number;
      response_body: unknown;
    }>(
      `SELECT body_hash, response_status, response_body
         FROM idempotency_key
        WHERE key = $1`,
      [key]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;

      if (row.body_hash !== bodyHash) {
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
      if (capturedStatus < 500 && capturedBody !== null) {
        // Fire-and-forget; errors here are non-fatal.
        pool
          .query(
            `INSERT INTO idempotency_key (key, body_hash, response_status, response_body, expires_at)
             VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key) DO NOTHING`,
            [key, bodyHash, capturedStatus, JSON.stringify(capturedBody)]
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
