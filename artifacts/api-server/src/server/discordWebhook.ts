/**
 * Minimal Discord webhook delivery for transaction events. There was no
 * existing webhook/notification plumbing anywhere in the codebase to reuse
 * (searched — none), so this is new: a league optionally sets
 * `discord_webhook_url`, and the four transaction events prompt C calls out
 * (trade_proposed, trade_executed, signing, waiver_claim) post a plain
 * message to it.
 *
 * Fire-and-forget by design: a Discord outage or a bad URL must never fail
 * or slow down the transaction it is reporting on.
 */
export type DiscordEvent = "trade_proposed" | "trade_executed" | "signing" | "waiver_claim";

export function postToDiscord(webhookUrl: string | null | undefined, content: string): void {
  if (!webhookUrl) return;
  fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => {
    // Swallow — a failed webhook delivery is not user-facing.
  });
}
