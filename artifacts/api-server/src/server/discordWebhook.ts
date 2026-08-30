/**
 * Discord webhook delivery for transaction events, via the transactional
 * outbox schema.sql already modeled (table `outbox`, present since v1.0.1)
 * but that nothing in the codebase used yet. A league optionally sets
 * `discord_webhook_url`, and the four events prompt C calls out
 * (trade_proposed, trade_executed, signing, waiver_claim) enqueue a row in
 * the SAME transaction as the business change; the outbox worker drains it
 * afterward. This is what the schema comment on `outbox` describes: "present
 * from day one so the first notification uses the pattern instead of a
 * direct in-request API call" — enqueue here, send in outboxWorker.ts.
 */
import type { Pool, PoolClient } from "pg";

export type DiscordEvent = "trade_proposed" | "trade_executed" | "signing" | "waiver_claim";

/** Call inside the same transaction as the change being announced, before
 * COMMIT — or with the bare pool for a handler with no transaction at all. */
export async function enqueueDiscordPost(
  client: Pool | PoolClient,
  webhookUrl: string | null | undefined,
  content: string,
): Promise<void> {
  if (!webhookUrl) return;
  await client.query(
    `INSERT INTO outbox (topic, payload) VALUES ('discord.post', $1)`,
    [JSON.stringify({ webhook_url: webhookUrl, content })],
  );
}

/** The actual delivery, called only by the outbox worker. */
export async function sendDiscordMessage(webhookUrl: string, content: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok && response.status !== 429) {
    // A 4xx (bad/revoked webhook URL) will never succeed on retry — log and
    // let the worker mark it processed rather than retrying forever.
    throw new PermanentDeliveryError(`Discord webhook returned ${response.status}`);
  }
  if (!response.ok) {
    throw new Error(`Discord webhook returned ${response.status}`);
  }
}

export class PermanentDeliveryError extends Error {}
