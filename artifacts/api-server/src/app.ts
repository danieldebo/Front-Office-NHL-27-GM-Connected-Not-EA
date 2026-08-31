import { existsSync, readFileSync } from "fs";
import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { clerkIdentityMiddleware } from "./server/auth/clerkIdentityMiddleware";
import { injectOgTags } from "./server/ogInject";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// Trust one layer of reverse-proxy headers so Clerk sees the public host and protocol.
app.set('trust proxy', 1);

// Allow the front-office frontend (same origin / proxied) to send credentials
app.use(
  cors({
    credentials: true,
    origin: true, // reflect request origin — safe because we control the proxy
  }),
);

// Clerk's Frontend API proxy must be mounted before body parsers.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => ({
    proxyUrl: `https://${getClerkProxyHost(req) ?? req.hostname}${CLERK_PROXY_PATH}`,
  })),
);
app.use(clerkIdentityMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ---------------------------------------------------------------------------
// Serve the built frontend and inject per-league OpenGraph tags on /l/:slug.
//
// FRONTEND_DIST_DIR is unset in dev and in every test process, so this block
// is a pure no-op there — nothing about the routes above changes behavior.
// It exists for the single-process production deployment this repo's
// .replit ([deployment] router = "application") implies: one process
// serving both the API and the static frontend build. Discord/Slack/etc.
// unfurl crawlers don't execute JS, so the tags must be in the HTML Express
// sends on the first request — client-side document.title edits (which the
// SPA still does, for the browser tab) don't reach them.
// ---------------------------------------------------------------------------
const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR;
if (FRONTEND_DIST_DIR && existsSync(path.join(FRONTEND_DIST_DIR, "index.html"))) {
  const indexPath = path.join(FRONTEND_DIST_DIR, "index.html");

  app.get(/^\/l\/([^/]+)\/?$/, async (req, res, next) => {
    try {
      const slug = req.params[0] as string;
      const template = readFileSync(indexPath, "utf8");

      const leagueRow = await pool.query<{
        name: string; visibility: string; public_code: string | null; logo_url: string | null;
      }>(
        `SELECT name, visibility, public_code, logo_url FROM league WHERE slug = $1 AND deleted_at IS NULL`,
        [slug]
      );
      const league = leagueRow.rows[0];

      const visible = !!league && (
        league.visibility === "public" ||
        (league.visibility === "unlisted" && !!league.public_code && req.query.code === league.public_code)
      );

      if (!visible) {
        res.setHeader("Content-Type", "text/html").send(template);
        return;
      }

      const html = injectOgTags(template, {
        title: `${league!.name} — Front Office`,
        description: `Standings, schedule, and rulebook for ${league!.name} on Front Office.`,
        url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        image: league!.logo_url,
      });
      res.setHeader("Content-Type", "text/html").send(html);
    } catch (err) {
      next(err);
    }
  });

  app.use(express.static(FRONTEND_DIST_DIR));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(indexPath);
  });
}

export default app;
