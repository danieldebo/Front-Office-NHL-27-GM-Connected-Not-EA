/**
 * Per-user and per-league rate limiting.
 *
 * In-memory buckets — intentionally simple for Phase 1.
 * Limits are per Replit instance. Sticky sessions mean this is
 * acceptable until a load-balanced multi-instance setup is needed.
 *
 * Returns 429 Too Many Requests with a Retry-After header on excess.
 */
import type { NextFunction, Request, Response } from "express";
import { getCurrentUser } from "../server/auth";

interface Bucket {
  tokens: number;
  last: number;
}

// Sliding-window token bucket: refills at `refillRate` tokens/second up to `capacity`.
class TokenBucket {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number // tokens per second
  ) {}

  consume(key: string): { allowed: boolean; retryAfterSecs: number } {
    const now = Date.now() / 1000;
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, last: now };
      this.buckets.set(key, bucket);
    }

    const elapsed = now - bucket.last;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsed * this.refillRate
    );
    bucket.last = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSecs: 0 };
    }

    const retryAfterSecs = Math.ceil((1 - bucket.tokens) / this.refillRate);
    return { allowed: false, retryAfterSecs };
  }

  /** Prune stale buckets — call periodically to prevent memory leaks. */
  prune(maxAgeSecs = 3600): void {
    const cutoff = Date.now() / 1000 - maxAgeSecs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.last < cutoff) this.buckets.delete(key);
    }
  }
}

// Limits:  60 req/min per user (1/sec), 300 req/min per league (5/sec)
const userBucket = new TokenBucket(60, 1);
const leagueBucket = new TokenBucket(300, 5);

// Prune stale entries every 10 minutes.
setInterval(() => {
  userBucket.prune();
  leagueBucket.prune();
}, 10 * 60 * 1000).unref();

/**
 * Rate-limit factory. Call with the league ID extracted from the path, or
 * undefined if the route is not league-scoped.
 */
export function rateLimiter(options: { getLeagueId?: (req: Request) => string | undefined } = {}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = getCurrentUser(req)?.id;
    const leagueId = options.getLeagueId?.(req);

    if (userId) {
      const { allowed, retryAfterSecs } = userBucket.consume(userId);
      if (!allowed) {
        res.setHeader("Retry-After", String(retryAfterSecs));
        res.status(429).json({
          type: "https://frontoffice.example/probs/429",
          title: "Too Many Requests",
          status: 429,
          detail: `Rate limit exceeded. Try again in ${retryAfterSecs}s.`,
          trace_id: req.id as string,
        });
        return;
      }
    }

    if (leagueId) {
      const { allowed, retryAfterSecs } = leagueBucket.consume(leagueId);
      if (!allowed) {
        res.setHeader("Retry-After", String(retryAfterSecs));
        res.status(429).json({
          type: "https://frontoffice.example/probs/429",
          title: "Too Many Requests",
          status: 429,
          detail: `League rate limit exceeded. Try again in ${retryAfterSecs}s.`,
          trace_id: req.id as string,
        });
        return;
      }
    }

    next();
  };
}
