import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

export interface DomainEvent {
  eventType: string;
  leagueId?: string | null;
  actorUserId?: string | null;
  audienceUserIds?: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Writes only to the transactional outbox; callers never invoke a channel. */
export async function publishDomainEvent(
  client: PoolClient,
  event: DomainEvent,
): Promise<string> {
  const eventId = randomUUID();
  await client.query(
    `INSERT INTO outbox (topic, payload, dedupe_key)
     VALUES ('domain.notification', $1::jsonb, $2)`,
    [JSON.stringify({
      event_id: eventId,
      event_type: event.eventType,
      league_id: event.leagueId ?? null,
      actor_user_id: event.actorUserId ?? null,
      audience_user_ids: event.audienceUserIds,
      title: event.title,
      body: event.body,
      data: event.data ?? {},
    }), eventId],
  );
  return eventId;
}

export function discordBackoffMs(attempt: number, retryAfter?: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay) && dateDelay > 0) return dateDelay;
  }
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 12));
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export const OUTBOX_MAX_ATTEMPTS = 10;

export function outboxRetryMs(attempt: number): number {
  return Math.min(60 * 60_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 12));
}

export function shouldDeadLetterOutbox(attempt: number): boolean {
  return attempt >= OUTBOX_MAX_ATTEMPTS;
}