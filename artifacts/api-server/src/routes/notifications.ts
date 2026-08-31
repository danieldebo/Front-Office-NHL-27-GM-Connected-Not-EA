import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  ListNotificationsQueryParams, ListNotificationsResponse,
  MarkNotificationReadParams, MarkNotificationReadResponse,
  UpdateNotificationPreferencesBody, UpdateNotificationPreferencesResponse,
  GetNotificationPreferencesResponse, CreateAnnouncementBody,
  CreateAnnouncementResponse, CreateAnnouncementParams, CreateDiscordWebhookBody,
  CreateDiscordWebhookParams, ListDiscordWebhooksParams,
  CreateDiscordWebhookResponse, ListDiscordWebhooksResponse,
  DeleteDiscordWebhookParams, TestDiscordWebhookParams,
  TestDiscordWebhookResponse, UpdateDiscordWebhookParams,
  UpdateDiscordWebhookBody, UpdateDiscordWebhookResponse,
} from "@workspace/api-zod";
import { getCurrentUser } from "../server/auth";
import { can } from "../server/authz";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../server/errors";
import { encryptWebhookUrl, maskWebhookUrl } from "../server/notifications/crypto";
import { publishDomainEvent } from "../server/notifications/domainEvents";

const router: IRouter = Router();

function parseDiscordUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      ["discord.com", "discordapp.com"].includes(url.hostname) &&
      url.pathname.startsWith("/api/webhooks/") ? url : null;
  } catch { return null; }
}

function appUserId(req: Request): string | null {
  const user = getCurrentUser(req);
  return user?.appUserId ?? null;
}

async function commissioner(req: Request, leagueId: string): Promise<boolean> {
  const user = getCurrentUser(req);
  if (!user) return false;
  const row = (await pool.query<{ owner_user_id: string; commissioner_ids: string[] }>(
    `SELECT l.owner_user_id,
       COALESCE(array_agg(m.user_id) FILTER (WHERE m.role IN ('commissioner','assistant_commissioner')
         AND m.left_at IS NULL), '{}') AS commissioner_ids
     FROM league l LEFT JOIN league_membership m ON m.league_id=l.id WHERE l.id=$1 GROUP BY l.id`,
    [leagueId],
  )).rows[0];
  return !!row && can(user, "league:write", {
    kind: "league", ownerId: row.owner_user_id, commissionerIds: row.commissioner_ids,
  });
}

router.get("/notifications", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const parsed = ListNotificationsQueryParams.safeParse(req.query);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const limit = parsed.data.limit ?? 50;
  const unread = parsed.data.unread_only ?? false;
  const rows = await pool.query(
    `SELECT id,league_id,event_type,title,body,data,created_at,read_at
       FROM notification_item WHERE user_id=$1 AND ($2::boolean=false OR read_at IS NULL)
       ORDER BY created_at DESC LIMIT $3`,
    [userId, unread, limit],
  );
  const count = await pool.query<{ count: string }>(
    `SELECT count(*) FROM notification_item WHERE user_id=$1 AND read_at IS NULL`, [userId],
  );
  res.json(ListNotificationsResponse.parse({
    data: rows.rows, unread_count: Number(count.rows[0]?.count ?? 0),
  }));
});

router.patch("/notifications/:notificationId/read", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const params = MarkNotificationReadParams.safeParse(req.params);
  if (!params.success) { badRequest(res, params.error.message); return; }
  const row = (await pool.query(
    `UPDATE notification_item SET read_at=COALESCE(read_at,now())
      WHERE id=$1 AND user_id=$2
      RETURNING id,league_id,event_type,title,body,data,created_at,read_at`,
    [params.data.notificationId, userId],
  )).rows[0];
  if (!row) { notFound(res, "Notification not found"); return; }
  res.json(MarkNotificationReadResponse.parse(row));
});

router.get("/notification-preferences", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const rows = await pool.query(
    `SELECT event_type,in_app,email,daily_digest FROM notification_preference
      WHERE user_id=$1 ORDER BY event_type`, [userId],
  );
  res.json(GetNotificationPreferencesResponse.parse({ data: rows.rows }));
});

router.put("/notification-preferences", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const parsed = UpdateNotificationPreferencesBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const p of parsed.data.preferences) {
      await client.query(
        `INSERT INTO notification_preference (user_id,event_type,in_app,email,daily_digest)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,event_type) DO UPDATE
         SET in_app=EXCLUDED.in_app,email=EXCLUDED.email,daily_digest=EXCLUDED.daily_digest,updated_at=now()`,
        [userId, p.event_type, p.in_app, p.email, p.daily_digest],
      );
    }
    const rows = await client.query(
      `SELECT event_type,in_app,email,daily_digest FROM notification_preference
        WHERE user_id=$1 ORDER BY event_type`, [userId],
    );
    await client.query("COMMIT");
    res.json(UpdateNotificationPreferencesResponse.parse({ data: rows.rows }));
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
});

router.post("/leagues/:leagueId/announcements", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const params = CreateAnnouncementParams.safeParse(req.params);
  if (!params.success) { badRequest(res, params.error.message); return; }
  const leagueId = params.data.leagueId;
  if (!(await commissioner(req, leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const parsed = CreateAnnouncementBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eventId = await publishDomainEvent(client, {
      eventType: "commissioner.announcement", leagueId, actorUserId: userId,
      title: parsed.data.title, body: parsed.data.body,
    });
    await client.query("COMMIT");
    res.status(202).json(CreateAnnouncementResponse.parse({ event_id: eventId, queued: true }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

router.get("/leagues/:leagueId/discord-webhooks", async (req: Request, res: Response): Promise<void> => {
  const params = ListDiscordWebhooksParams.safeParse(req.params);
  if (!params.success) { badRequest(res, params.error.message); return; }
  const leagueId = params.data.leagueId;
  if (!appUserId(req)) { unauthorized(res, "Authentication required"); return; }
  if (!(await commissioner(req, leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const rows = await pool.query(
    `SELECT id,name,event_filters,enabled,failure_count,disabled_at,created_at
       FROM discord_webhook WHERE league_id=$1 ORDER BY created_at`, [leagueId],
  );
  res.json(ListDiscordWebhooksResponse.parse({
    data: rows.rows.map((row) => ({ ...row, masked_url: maskWebhookUrl() })),
  }));
});

router.post("/leagues/:leagueId/discord-webhooks", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const params = CreateDiscordWebhookParams.safeParse(req.params);
  if (!params.success) { badRequest(res, params.error.message); return; }
  const leagueId = params.data.leagueId;
  if (!(await commissioner(req, leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const parsed = CreateDiscordWebhookBody.safeParse(req.body);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  const url = parseDiscordUrl(parsed.data.url);
  if (!url) {
    badRequest(res, "URL must be an HTTPS Discord webhook URL"); return;
  }
  const encrypted = encryptWebhookUrl(url.toString());
  try {
    const row = (await pool.query(
      `INSERT INTO discord_webhook
       (league_id,name,url_ciphertext,url_iv,url_auth_tag,event_filters,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,name,event_filters,enabled,failure_count,disabled_at,created_at`,
      [leagueId, parsed.data.name, encrypted.ciphertext, encrypted.iv, encrypted.authTag,
        parsed.data.event_filters, userId],
    )).rows[0];
    res.status(201).json(CreateDiscordWebhookResponse.parse({ ...row, masked_url: maskWebhookUrl() }));
  } catch (error) {
    if ((error as { code?: string }).code === "23514") {
      conflict(res, "A league may have at most five Discord webhooks"); return;
    }
    throw error;
  }
});

router.patch("/leagues/:leagueId/discord-webhooks/:webhookId", async (req: Request, res: Response): Promise<void> => {
  if (!appUserId(req)) { unauthorized(res, "Authentication required"); return; }
  const params = UpdateDiscordWebhookParams.safeParse(req.params);
  const body = UpdateDiscordWebhookBody.safeParse(req.body);
  if (!params.success || !body.success) { badRequest(res, "Invalid webhook update"); return; }
  if (!(await commissioner(req, params.data.leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const url = body.data.url === undefined ? null : parseDiscordUrl(body.data.url);
  if (body.data.url !== undefined && !url) { badRequest(res, "URL must be an HTTPS Discord webhook URL"); return; }
  const encrypted = url ? encryptWebhookUrl(url.toString()) : null;
  const row = (await pool.query(
    `UPDATE discord_webhook SET
       name=COALESCE($3,name), event_filters=COALESCE($4,event_filters),
       enabled=COALESCE($5,enabled),
       disabled_at=CASE WHEN $5::boolean IS TRUE THEN NULL ELSE disabled_at END,
       failure_count=CASE WHEN $5::boolean IS TRUE THEN 0 ELSE failure_count END,
       url_ciphertext=COALESCE($6,url_ciphertext),
       url_iv=COALESCE($7,url_iv), url_auth_tag=COALESCE($8,url_auth_tag)
     WHERE id=$1 AND league_id=$2
     RETURNING id,name,event_filters,enabled,failure_count,disabled_at,created_at`,
    [params.data.webhookId, params.data.leagueId, body.data.name ?? null,
      body.data.event_filters ?? null, body.data.enabled ?? null,
      encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.authTag ?? null],
  )).rows[0];
  if (!row) { notFound(res, "Webhook not found"); return; }
  res.json(UpdateDiscordWebhookResponse.parse({ ...row, masked_url: maskWebhookUrl() }));
});

router.delete("/leagues/:leagueId/discord-webhooks/:webhookId", async (req: Request, res: Response): Promise<void> => {
  if (!appUserId(req)) { unauthorized(res, "Authentication required"); return; }
  const parsed = DeleteDiscordWebhookParams.safeParse(req.params);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  if (!(await commissioner(req, parsed.data.leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const result = await pool.query(`DELETE FROM discord_webhook WHERE id=$1 AND league_id=$2`,
    [parsed.data.webhookId, parsed.data.leagueId]);
  if (!result.rowCount) { notFound(res, "Webhook not found"); return; }
  res.status(204).send();
});

router.post("/leagues/:leagueId/discord-webhooks/:webhookId/test", async (req: Request, res: Response): Promise<void> => {
  const userId = appUserId(req);
  if (!userId) { unauthorized(res, "Authentication required"); return; }
  const parsed = TestDiscordWebhookParams.safeParse(req.params);
  if (!parsed.success) { badRequest(res, parsed.error.message); return; }
  if (!(await commissioner(req, parsed.data.leagueId))) { forbidden(res, "Commissioner access required"); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const webhook = await client.query(`SELECT id FROM discord_webhook WHERE id=$1 AND league_id=$2 AND enabled`,
      [parsed.data.webhookId, parsed.data.leagueId]);
    if (!webhook.rows[0]) { await client.query("ROLLBACK"); notFound(res, "Webhook not found"); return; }
    const eventId = await publishDomainEvent(client, {
      eventType: "discord.test", leagueId: null, actorUserId: userId,
      title: "Front Office webhook test", body: "Your Discord webhook is configured correctly.",
    });
    const outbox = await client.query<{ id: string }>(
      `UPDATE outbox SET processed_at=now() WHERE dedupe_key=$1 RETURNING id`, [eventId],
    );
    await client.query(
      `INSERT INTO notification_delivery_job (event_id,outbox_id,channel,webhook_id)
       VALUES ($1,$2,'discord',$3)`,
      [eventId, outbox.rows[0]!.id, parsed.data.webhookId],
    );
    await client.query("COMMIT");
    res.status(202).json(TestDiscordWebhookResponse.parse({ event_id: eventId, queued: true }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

export default router;