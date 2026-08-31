/**
 * Generic outbox drain worker — schema.sql's `outbox` table, described there
 * as "drained by a worker with at-least-once delivery and idempotent
 * handlers." Also doubles as the job queue for the registry sync and
 * stat-card refresh (docs/registry-sync-spec.md §2/§3 explicitly call for
 * reusing this pattern rather than a separate queue service).
 *
 * Started once from index.ts (the real process entrypoint) — never from
 * app.ts, which tests import directly; a setInterval poller has no place
 * running inside a test process.
 */
import type { Pool } from "pg";
import { sendDiscordMessage, PermanentDeliveryError } from "./discordWebhook";
import { runRegistrySync } from "./jobs/registrySync";
import { refreshStatCards } from "./jobs/statCardRefresh";
import { sendEmail } from "./emailSender";
import { logger } from "../lib/logger";

interface OutboxRow {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 8;

async function handle(pool: Pool, row: OutboxRow): Promise<void> {
  switch (row.topic) {
    case "discord.post": {
      const { webhook_url, content } = row.payload as { webhook_url: string; content: string };
      await sendDiscordMessage(webhook_url, content);
      return;
    }
    case "registry.sync.requested": {
      const result = await runRegistrySync(pool);
      if (result.error) throw new Error(result.error);
      return;
    }
    case "statcard.refresh.requested": {
      const { player_id } = row.payload as { player_id: string };
      await refreshStatCards(pool, player_id);
      return;
    }
    case "email.digest": {
      const { to, subject, text } = row.payload as { to: string; subject: string; text: string };
      await sendEmail({ to, subject, text });
      return;
    }
    default:
      // An unknown topic will never succeed — drop it rather than retry forever.
      logger.warn({ topic: row.topic }, "outbox: unknown topic, dropping");
      return;
  }
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** attempts);
}

export async function drainOnce(pool: Pool): Promise<void> {
  // The SELECT ... FOR UPDATE SKIP LOCKED and every row's outcome UPDATE share
  // one transaction, so the row locks stay held for as long as handle() takes
  // to run. Without this, a bare pool.query's implicit auto-commit releases
  // the locks the instant the SELECT finishes — before the job actually
  // executes — so a slow job (e.g. a registry sync overrunning the poll
  // interval) could be picked up and run again by the next tick.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, topic, payload, attempts FROM outbox
        WHERE processed_at IS NULL AND next_attempt_at <= now()
        ORDER BY id ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      try {
        await handle(pool, row);
        await client.query(`UPDATE outbox SET processed_at = now() WHERE id = $1`, [row.id]);
      } catch (err) {
        const permanent = err instanceof PermanentDeliveryError || row.attempts + 1 >= MAX_ATTEMPTS;
        const message = err instanceof Error ? err.message : String(err);
        if (permanent) {
          logger.error({ topic: row.topic, id: row.id, err: message }, "outbox: giving up on delivery");
          await client.query(
            `UPDATE outbox SET processed_at = now(), attempts = attempts + 1, last_error = $2 WHERE id = $1`,
            [row.id, message],
          );
        } else {
          await client.query(
            `UPDATE outbox SET attempts = attempts + 1, last_error = $2,
                    next_attempt_at = now() + ($3 || ' milliseconds')::interval
              WHERE id = $1`,
            [row.id, message, backoffMs(row.attempts + 1)],
          );
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export function startOutboxWorker(pool: Pool, intervalMs = 5000): { stop: () => void } {
  const timer = setInterval(() => {
    drainOnce(pool).catch((err) => logger.error({ err }, "outbox: drain loop failed"));
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
