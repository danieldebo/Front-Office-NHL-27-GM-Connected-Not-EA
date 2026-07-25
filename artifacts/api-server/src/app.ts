import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

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
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Allow the front-office frontend (same origin / proxied) to send credentials
app.use(
  cors({
    credentials: true,
    origin: true, // reflect request origin — safe because we control the proxy
  })
);

app.use(cookieParser(process.env.SESSION_SECRET));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth: attach req.user to every request before routes run
app.use(authMiddleware);

app.use("/api", router);

export default app;
