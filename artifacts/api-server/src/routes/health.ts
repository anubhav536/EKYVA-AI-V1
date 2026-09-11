import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { refreshProviderHealth } from "../lib/provider-health";

const router: IRouter = Router();

async function health(_req: Parameters<Parameters<typeof router.get>[1]>[0], res: Parameters<Parameters<typeof router.get>[1]>[1]) {
  const [providers] = await Promise.all([
    refreshProviderHealth(),
    db.execute(sql`select 1`),
  ]);
  const status = providers.some((provider) => provider.status === "offline") ? "degraded" : "ok";
  const data = HealthCheckResponse.parse({ status });
  res.json(data);
}

router.get("/healthz", health);
router.get("/v1/health", health);

export default router;
