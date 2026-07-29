import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";
import { passport } from "./lib/passport";

const PgStore = connectPgSimple(session);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!process.env.SESSION_SECRET) {
  throw new Error(
    'SESSION_SECRET environment variable is required. ' +
    'Generate one with: openssl rand -hex 32',
  );
}

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

// Trust one layer of reverse-proxy headers (X-Forwarded-Proto, X-Forwarded-For).
// Required so express-session issues `secure` cookies correctly when TLS is
// terminated upstream (Replit dev proxy, Deployments CDN, etc.).
app.set('trust proxy', 1);

// Allow the front-office frontend (same origin / proxied) to send credentials
app.use(
  cors({
    credentials: true,
    origin: true, // reflect request origin — safe because we control the proxy
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session store ───────────────────────────────────────────────────────────
// Uses the existing `sessions` table (sid / sess / expire) via pg pool.
app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: false,
      // Prune expired sessions every hour
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    name: "sid",
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
    },
  }),
);

// ── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

app.use("/api", router);

export default app;
