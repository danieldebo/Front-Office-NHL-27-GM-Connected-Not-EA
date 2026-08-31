import app from "./app";
import { logger } from "./lib/logger";
import { runNotificationDispatcher } from "./server/notifications/dispatcher";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  const timer = setInterval(() => {
    void runNotificationDispatcher().catch((error) => {
      logger.error({ err: error }, "Notification dispatcher tick failed");
    });
  }, 1_000);
  timer.unref();
});
