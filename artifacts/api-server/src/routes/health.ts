import { Router, type IRouter, type RequestHandler } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const livenessHandler: RequestHandler = (_req, res) => {
  res.json({ status: "ok" });
};

export const readinessHandler: RequestHandler = async (_req, res) => {
  try {
    const result = await pool.query<{ ready: boolean }>(
      `SELECT
         to_regclass('public.league') IS NOT NULL
         AND to_regclass('public.league_listing') IS NOT NULL
         AND to_regclass('public.v_open_leagues') IS NOT NULL
         AND to_regclass('public.notification_delivery_job') IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'league'
              AND column_name = 'visibility'
         )
         AND EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'league_listing'
              AND column_name = 'platform'
              AND data_type = 'text'
         )
         AND EXISTS (
           SELECT 1
             FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'outbox'
              AND column_name = 'dead_lettered_at'
         ) AS ready`,
    );
    if (!result.rows[0]?.ready) {
      res.status(503).json({ status: "unavailable" });
      return;
    }
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (error) {
    logger.warn({ err: error }, "Readiness check failed");
    res.status(503).json({ status: "unavailable" });
  }
};

router.get("/healthz", readinessHandler);
router.get("/livez", livenessHandler);
router.get("/readyz", readinessHandler);

export default router;
