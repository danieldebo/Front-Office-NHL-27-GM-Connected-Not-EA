import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkIdentityMiddleware } from "./server/auth/clerkIdentityMiddleware";
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

export default app;
