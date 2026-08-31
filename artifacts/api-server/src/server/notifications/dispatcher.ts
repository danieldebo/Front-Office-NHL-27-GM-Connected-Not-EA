import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { decryptWebhookUrl } from "./crypto";
import {
  discordBackoffMs, isRetryableStatus, outboxRetryMs, shouldDeadLetterOutbox,
} from "./domainEvents";

type Payload = {
  event_id: string; event_type: string; league_id: string | null;
  audience_user_ids?: string[]; title: string; body: string;
  data?: Record<string, unknown>;
};
type ClaimedJob = {
  id: string; event_id: string; channel: "in_app" | "email" | "discord";
  user_id: string | null; webhook_id: string | null; attempts: number;
  payload: Payload; email: string | null; url_ciphertext: Buffer | null;
  url_iv: Buffer | null; url_auth_tag: Buffer | null; claim_token: string;
};
type DeliveryError = Error & { status?: number; retryAfter?: string | null };

const LEASE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export function leaseExpiresAt(now = Date.now(), leaseMs = LEASE_MS): Date {
  return new Date(now + leaseMs);
}

export async function fanOutOneEvent(): Promise<boolean> {
  const client = await pool.connect();
  let outboxId: string | null = null;
  try {
    await client.query("BEGIN");
    const claimed = await client.query<{ id: string; payload: Payload }>(
      `SELECT id, payload FROM outbox
       WHERE processed_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= now()
         AND topic = 'domain.notification' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const row = claimed.rows[0];
    if (!row) { await client.query("COMMIT"); return false; }
    outboxId = row.id;
    await client.query("SAVEPOINT notification_fanout");
    const p = row.payload;
    const recipients = p.audience_user_ids?.length ? p.audience_user_ids : p.league_id
      ? (await client.query<{ user_id: string }>(
          `SELECT user_id FROM league_membership WHERE league_id=$1 AND left_at IS NULL
           UNION SELECT owner_user_id FROM league WHERE id=$1`, [p.league_id],
        )).rows.map((r) => r.user_id) : [];
    for (const userId of new Set(recipients)) {
      const pref = (await client.query<{ in_app: boolean; email: boolean; daily_digest: boolean }>(
        `SELECT in_app,email,daily_digest FROM notification_preference WHERE user_id=$1 AND event_type=$2`,
        [userId, p.event_type],
      )).rows[0] ?? { in_app: true, email: false, daily_digest: false };
      if (pref.in_app) await client.query(
        `INSERT INTO notification_delivery_job (event_id,outbox_id,channel,user_id)
         VALUES ($1,$2,'in_app',$3) ON CONFLICT DO NOTHING`, [p.event_id, row.id, userId],
      );
      if (pref.email) await client.query(
        `INSERT INTO notification_delivery_job (event_id,outbox_id,channel,user_id,status)
         VALUES ($1,$2,'email',$3,$4) ON CONFLICT DO NOTHING`,
        [p.event_id, row.id, userId, pref.daily_digest ? "digest_pending" : "pending"],
      );
    }
    if (p.league_id) await client.query(
      `INSERT INTO notification_delivery_job (event_id,outbox_id,channel,webhook_id)
       SELECT $1,$2,'discord',id FROM discord_webhook
        WHERE league_id=$3 AND enabled AND $4=ANY(event_filters) ON CONFLICT DO NOTHING`,
      [p.event_id, row.id, p.league_id, p.event_type],
    );
    await client.query(`UPDATE outbox SET processed_at=now() WHERE id=$1`, [row.id]);
    await client.query("RELEASE SAVEPOINT notification_fanout");
    await client.query("COMMIT");
    return true;
  } catch (error) {
    if (!outboxId) {
      await client.query("ROLLBACK");
      logger.error({ err: error }, "Notification event fan-out failed before claim");
      return false;
    }
    try {
      // Retain the row lock while undoing only partial delivery-job/inbox work.
      await client.query("ROLLBACK TO SAVEPOINT notification_fanout");
      const attemptRow = await client.query<{ attempts: number }>(
        `SELECT attempts FROM outbox WHERE id=$1 FOR UPDATE`, [outboxId],
      );
      const attempt = (attemptRow.rows[0]?.attempts ?? 0) + 1;
      const terminal = shouldDeadLetterOutbox(attempt);
      await client.query(
        `UPDATE outbox SET attempts=$2,last_error=$3,next_attempt_at=now()+($4 * interval '1 millisecond'),
           dead_lettered_at=CASE WHEN $5 THEN now() ELSE NULL END WHERE id=$1`,
        [outboxId, attempt, (error instanceof Error ? error.message : "Notification fan-out failed").slice(0, 500),
          outboxRetryMs(attempt), terminal],
      );
      await client.query("COMMIT");
      logger.warn({ outboxId, attempt, terminal }, "Notification event fan-out deferred");
    } catch (finalizationError) {
      await client.query("ROLLBACK");
      logger.error({ err: finalizationError, outboxId }, "Notification fan-out failure finalization failed");
    }
    return false;
  } finally { client.release(); }
}

async function claimOneImmediate(): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  const token = randomUUID();
  try {
    await client.query("BEGIN");
    const result = await client.query<ClaimedJob>(
      `WITH candidate AS (
         SELECT j.id FROM notification_delivery_job j
          WHERE j.status IN ('pending','retry') AND j.next_attempt_at<=now()
            AND (j.lease_expires_at IS NULL OR j.lease_expires_at<now())
          ORDER BY j.id FOR UPDATE SKIP LOCKED LIMIT 1
       ), claimed AS (
         UPDATE notification_delivery_job j SET claim_token=$1,lease_expires_at=$2
          FROM candidate WHERE j.id=candidate.id RETURNING j.*
       )
       SELECT c.*,o.payload,u.email,w.url_ciphertext,w.url_iv,w.url_auth_tag
         FROM claimed c JOIN outbox o ON o.id=c.outbox_id
         LEFT JOIN app_user u ON u.id=c.user_id LEFT JOIN discord_webhook w ON w.id=c.webhook_id`,
      [token, leaseExpiresAt()],
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const endpoint = process.env.EMAIL_PROVIDER_URL;
  const token = process.env.EMAIL_PROVIDER_TOKEN;
  if (!endpoint || !token) throw new Error("Email provider is not configured");
  const response = await fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ to, subject, text: body }),
  });
  if (!response.ok) throw Object.assign(new Error(`Email provider returned HTTP ${response.status}`), { status: response.status });
}

async function sendDiscord(job: ClaimedJob): Promise<void> {
  const url = decryptWebhookUrl({
    ciphertext: job.url_ciphertext!, iv: job.url_iv!, authTag: job.url_auth_tag!,
  });
  const response = await fetch(url, {
    method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: `**${job.payload.title}**\n${job.payload.body}` }),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Discord returned HTTP ${response.status}`), {
      status: response.status, retryAfter: response.headers.get("retry-after"),
    });
  }
}

async function finalizeSuccess(job: ClaimedJob): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (job.channel === "in_app") {
      await client.query(
         `INSERT INTO notification_item (event_id,user_id,league_id,event_type,title,body,data)
          SELECT (o.payload->>'event_id')::uuid,j.user_id,(o.payload->>'league_id')::uuid,
                o.payload->>'event_type',o.payload->>'title',o.payload->>'body',
                COALESCE(o.payload->'data','{}'::jsonb)
           FROM notification_delivery_job j JOIN outbox o ON o.id=j.outbox_id
          WHERE j.id=$1 AND j.claim_token=$2 ON CONFLICT DO NOTHING`,
        [job.id, job.claim_token],
      );
    }
    const updated = await client.query(
      `UPDATE notification_delivery_job SET status='sent',attempts=attempts+1,delivered_at=now(),
         last_error=NULL,claim_token=NULL,lease_expires_at=NULL
       WHERE id=$1 AND claim_token=$2`, [job.id, job.claim_token],
    );
    if (updated.rowCount === 1 && job.channel === "discord") {
      await client.query(`UPDATE discord_webhook SET failure_count=0 WHERE id=$1`, [job.webhook_id]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function finalizeFailure(job: ClaimedJob, error: DeliveryError): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ attempts: number; webhook_id: string | null }>(
      `SELECT attempts,webhook_id FROM notification_delivery_job WHERE id=$1 AND claim_token=$2 FOR UPDATE`,
      [job.id, job.claim_token],
    );
    if (!current.rows[0]) { await client.query("COMMIT"); return; }
    const retryable = job.channel === "email" || error.status === undefined || isRetryableStatus(error.status);
    const safeError = job.channel === "discord"
      ? (error.status ? `Discord returned HTTP ${error.status}` : "Discord request failed")
      : error.message.slice(0, 500);
    const attempt = current.rows[0].attempts + 1;
    await client.query(
      `UPDATE notification_delivery_job SET attempts=$3,status=$4,last_error=$5,
         next_attempt_at=now()+($6 * interval '1 millisecond'),
         claim_token=NULL,lease_expires_at=NULL WHERE id=$1 AND claim_token=$2`,
      [job.id, job.claim_token, attempt, retryable ? "retry" : "failed", safeError,
        discordBackoffMs(attempt, error.retryAfter)],
    );
    if (job.webhook_id && !retryable) {
      const disabled = await client.query<{ league_id: string; failure_count: number }>(
        `UPDATE discord_webhook SET failure_count=failure_count+1,
           enabled=CASE WHEN failure_count+1>=3 THEN FALSE ELSE enabled END,
           disabled_at=CASE WHEN failure_count+1>=3 THEN now() ELSE disabled_at END
         WHERE id=$1 RETURNING league_id,failure_count`, [job.webhook_id],
      );
      if (disabled.rows[0]?.failure_count === 3) await client.query(
        `INSERT INTO notification_item (event_id,user_id,league_id,event_type,title,body)
         SELECT gen_random_uuid(),recipient,l.id,'discord.webhook_disabled','Discord webhook disabled',
                'A Discord webhook was disabled after repeated delivery failures.'
           FROM league l CROSS JOIN LATERAL (
             SELECT l.owner_user_id AS recipient UNION SELECT m.user_id FROM league_membership m
             WHERE m.league_id=l.id AND m.left_at IS NULL
               AND m.role IN ('commissioner','assistant_commissioner')
           ) r WHERE l.id=$1`, [disabled.rows[0].league_id],
      );
    }
    await client.query("COMMIT");
    logger.warn({ channel: job.channel, error: job.channel === "discord" ? "Discord request failed" : error.message },
      "Notification delivery failed");
  } catch (failure) {
    await client.query("ROLLBACK");
    logger.error({ err: failure }, "Notification delivery finalization failed");
  } finally { client.release(); }
}

export async function deliverOneJob(): Promise<boolean> {
  const job = await claimOneImmediate();
  if (!job) return false;
  try {
    if (job.channel === "email") await sendEmail(job.email!, job.payload.title, job.payload.body);
    else if (job.channel === "discord") await sendDiscord(job);
    // In-app has no network call; it is finalized under its short DB transaction.
    await finalizeSuccess(job);
    return true;
  } catch (error) {
    await finalizeFailure(job, error as DeliveryError);
    return false;
  }
}

async function claimOneDigest(): Promise<{ token: string; userId: string; email: string; jobs: Array<{ id: string; payload: Payload }> } | null> {
  const client = await pool.connect();
  const token = randomUUID();
  try {
    await client.query("BEGIN");
    const candidate = await client.query<{ user_id: string; email: string }>(
      `SELECT j.user_id,u.email FROM notification_delivery_job j JOIN app_user u ON u.id=j.user_id
        WHERE j.status='digest_pending' AND j.created_at<date_trunc('day',now()) AND j.next_attempt_at<=now()
          AND (j.lease_expires_at IS NULL OR j.lease_expires_at<now())
        ORDER BY j.id LIMIT 1`,
    );
    const user = candidate.rows[0];
    if (!user) { await client.query("COMMIT"); return null; }
    // Serialize digest claims by recipient, not by an arbitrary first job row.
    // This avoids two workers locking separate rows and then cross-updating a batch.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`notification-digest:${user.user_id}`]);
    const jobs = await client.query<{ id: string; payload: Payload }>(
      `UPDATE notification_delivery_job j SET claim_token=$2,lease_expires_at=$3
        FROM outbox o WHERE j.outbox_id=o.id AND j.user_id=$1 AND j.status='digest_pending'
           AND j.created_at<date_trunc('day',now()) AND j.next_attempt_at<=now()
           AND (j.lease_expires_at IS NULL OR j.lease_expires_at<now())
        RETURNING j.id,o.payload`, [user.user_id, token, leaseExpiresAt()],
    );
    await client.query("COMMIT");
    if (jobs.rows.length === 0) return null;
    return { token, userId: user.user_id, email: user.email, jobs: jobs.rows };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function deliverOneDigest(): Promise<boolean> {
  const digest = await claimOneDigest();
  if (!digest) return false;
  const ids = digest.jobs.map((j) => j.id);
  try {
    const text = digest.jobs.map(({ payload }) => `${payload.title}\n${payload.body}`).join("\n\n");
    await sendEmail(digest.email, "Your Front Office daily digest", text);
    await pool.query(
      `UPDATE notification_delivery_job SET status='sent',attempts=attempts+1,delivered_at=now(),
        last_error=NULL,claim_token=NULL,lease_expires_at=NULL
       WHERE id=ANY($1::bigint[]) AND claim_token=$2`, [ids, digest.token],
    );
    return true;
  } catch (error) {
    await pool.query(
      `UPDATE notification_delivery_job SET attempts=attempts+1,last_error=$3,
        next_attempt_at=now()+interval '15 minutes',claim_token=NULL,lease_expires_at=NULL
       WHERE id=ANY($1::bigint[]) AND claim_token=$2`,
      [ids, digest.token, (error as Error).message.slice(0, 500)],
    );
    logger.warn({ channel: "email_digest", error: (error as Error).message }, "Notification digest delivery failed");
    return false;
  }
}

export async function runNotificationDispatcher(): Promise<void> {
  await fanOutOneEvent();
  await deliverOneDigest();
  await deliverOneJob();
}