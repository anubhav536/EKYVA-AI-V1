import app from "./app";
import { logger } from "./lib/logger";
import { refreshProviderHealth } from "./lib/provider-health";

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
  void refreshProviderHealth().catch((error) => logger.warn({ err: error }, "Initial provider health refresh failed"));
  const healthTimer = setInterval(() => {
    void refreshProviderHealth().catch((error) => logger.warn({ err: error }, "Provider health refresh failed"));
  }, 60_000);
  healthTimer.unref();
});
