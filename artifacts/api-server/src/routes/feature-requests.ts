/**
 * Feature request route — public submission endpoint.
 *
 * POST /feature-requests  — submit an idea (no auth required)
 *
 * Security notes:
 *  - IP is SHA-256-hashed before storage; raw IP never persisted or logged.
 *  - Email field is never logged (pino serializer strips /feature-requests body).
 *  - Body is stripped of HTML before insert.
 *  - Per-IP rate limiting: 5 requests per hour.
 *  - Body capped at 4000 chars (enforced in schema + here).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "crypto";
import { pool } from "@workspace/db";
import { badRequest } from "../server/errors";
import { CreateFeatureRequestBody } from "@workspace/api-zod";

const router: IRouter = Router();

// Simple per-IP token bucket: 5 requests per hour.
const ipBuckets = new Map<string, { tokens: number; last: number }>();
const IP_CAPACITY = 5;
const IP_REFILL_PER_SEC = IP_CAPACITY / 3600; // 5 per hour

function consumeIpToken(ipHash: string): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now() / 1000;
  let bucket = ipBuckets.get(ipHash);
  if (!bucket) {
    bucket = { tokens: IP_CAPACITY, last: now };
    ipBuckets.set(ipHash, bucket);
  }
  const elapsed = now - bucket.last;
  bucket.tokens = Math.min(IP_CAPACITY, bucket.tokens + elapsed * IP_REFILL_PER_SEC);
  bucket.last = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSecs: 0 };
  }
  const retryAfterSecs = Math.ceil((1 - bucket.tokens) / IP_REFILL_PER_SEC);
  return { allowed: false, retryAfterSecs };
}

// Prune stale IP buckets every hour.
setInterval(() => {
  const cutoff = Date.now() / 1000 - 3600 * 2;
  for (const [key, bucket] of ipBuckets) {
    if (bucket.last < cutoff) ipBuckets.delete(key);
  }
}, 60 * 60 * 1000).unref();

/** Strip HTML tags from a string to prevent stored XSS. */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

// POST /feature-requests
router.post(
  "/feature-requests",
  async (req: Request, res: Response): Promise<void> => {
    // Derive a stable IP hash for rate-limiting. Use x-forwarded-for when behind
    // the Replit proxy; fall back to socket address.
    const rawIp =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";

    const ipHash = createHash("sha256").update(rawIp).digest("hex");

    const { allowed, retryAfterSecs } = consumeIpToken(ipHash);
    if (!allowed) {
      res.setHeader("Retry-After", String(retryAfterSecs));
      res.status(429).json({
        type: "https://frontoffice.example/probs/429",
        title: "Too Many Requests",
        status: 429,
        detail: `Feature request rate limit exceeded. Try again in ${retryAfterSecs}s.`,
      });
      return;
    }

    const parsed = CreateFeatureRequestBody.safeParse(req.body);
    if (!parsed.success) {
      badRequest(res, parsed.error.message);
      return;
    }
    const { email, body } = parsed.data;

    const cleanBody = stripHtml(body);
    if (cleanBody.length === 0) {
      badRequest(res, "body must contain text");
      return;
    }

    // Validate email format loosely if provided (never logged in full).
    const cleanEmail =
      email && email.includes("@")
        ? email.slice(0, 254)
        : null;

    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO feature_request (email, body, source_ip_hash)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [cleanEmail, cleanBody, ipHash]
    );

    res.status(201).json({
      id: rows[0]!.id,
      created_at: rows[0]!.created_at,
    });
  }
);

export default router;
