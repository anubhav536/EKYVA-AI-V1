import { desc, eq } from "drizzle-orm";
import { db, providersTable, providerHealthTable } from "@workspace/db";
import { providerAdapters, setProviderStatus, type ProviderStatus } from "./providers";

export type ProviderHealthSnapshot = {
  provider: string;
  name: string;
  status: ProviderStatus;
  latencyMs: number;
  checkedAt: string;
};

async function providerId(key: string, name: string) {
  const existing = (await db.select().from(providersTable).where(eq(providersTable.key, key)).limit(1))[0];
  if (existing) return existing.id;
  const created = (await db.insert(providersTable).values({
    key,
    name,
    adapter: `${name}Adapter`,
  }).onConflictDoNothing().returning())[0];
  if (created) return created.id;
  return (await db.select().from(providersTable).where(eq(providersTable.key, key)).limit(1))[0]?.id;
}

export async function refreshProviderHealth(): Promise<ProviderHealthSnapshot[]> {
  const snapshots: ProviderHealthSnapshot[] = [];
  for (const adapter of providerAdapters) {
    const started = Date.now();
    const health = await adapter.healthCheck().catch(() => ({ status: "offline" as const, latencyMs: Date.now() - started }));
    setProviderStatus(adapter.key, health.status);
    const checkedAt = new Date().toISOString();
    const id = await providerId(adapter.key, adapter.name);
    if (id) {
      await db.insert(providerHealthTable).values({
        providerId: id,
        status: health.status,
        latencyMs: health.latencyMs,
        failureRate: health.status === "healthy" ? "0" : "1",
      });
    }
    snapshots.push({ provider: adapter.key, name: adapter.name, status: health.status, latencyMs: health.latencyMs, checkedAt });
  }
  return snapshots;
}

export async function latestProviderHealth() {
  const rows = await db.select({
    provider: providersTable.key,
    name: providersTable.name,
    status: providerHealthTable.status,
    latencyMs: providerHealthTable.latencyMs,
    checkedAt: providerHealthTable.checkedAt,
  }).from(providerHealthTable)
    .innerJoin(providersTable, eq(providersTable.id, providerHealthTable.providerId))
    .orderBy(desc(providerHealthTable.checkedAt));
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!latest.has(row.provider)) latest.set(row.provider, row);
  return [...latest.values()].map((row) => ({
    provider: row.provider,
    name: row.name,
    status: row.status as ProviderStatus,
    latencyMs: row.latencyMs,
    checkedAt: row.checkedAt.toISOString(),
  }));
}