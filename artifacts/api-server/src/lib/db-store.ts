import crypto from "node:crypto";
import {
  and,
  desc,
  eq,
  gte,
  isNull,
  sql,
} from "drizzle-orm";
import {
  apiKeysTable,
  db,
  requestsTable,
  routingPoliciesTable,
  usersTable,
  walletsTable,
  walletTransactionsTable,
  usageRecordsTable,
  requestAttemptsTable,
} from "@workspace/db";
import type { RoutingMode } from "./routing";

export type DbAccount = {
  id: string;
  clerkUserId: string;
  email: string;
  name: string;
  plan: string;
  routingMode: RoutingMode;
  createdAt: Date;
};

export type DbRequestSummary = {
  id: string;
  capability: string;
  model: string;
  provider: string;
  status: "completed" | "failed" | "processing";
  units: number;
  latencyMs: number;
  createdAt: string;
};

function asNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

export async function ensureAccount(clerkUserId: string): Promise<DbAccount> {
  let user = (await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1))[0];
  if (!user) {
    try {
      user = (await db.insert(usersTable).values({
        clerkUserId,
        email: clerkUserId === "demo-user" ? "operator@ekyva.dev" : `${clerkUserId}@accounts.ekyva.dev`,
        name: clerkUserId === "demo-user" ? "EKYVA Operator" : "EKYVA User",
      }).returning())[0];
    } catch {
      user = (await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)).limit(1))[0];
    }
  }
  if (!user) throw new Error("ACCOUNT_PROVISIONING_FAILED");

  const existingWallet = (await db.select({ id: walletsTable.id }).from(walletsTable).where(eq(walletsTable.userId, user.id)).limit(1))[0];
  if (!existingWallet) {
    try {
      await db.transaction(async (tx) => {
        const wallet = (await tx.insert(walletsTable).values({
          userId: user.id,
          balance: "1000",
          currency: "UU",
        }).returning())[0];
        await tx.insert(walletTransactionsTable).values({
          walletId: wallet.id,
          type: "BONUS",
          units: "1000",
          balanceAfter: "1000",
          description: "Free plan welcome allocation",
        });
      });
    } catch {
      // Another request may have provisioned the wallet concurrently.
    }
  }

  const policy = (await db.select({ id: routingPoliciesTable.id }).from(routingPoliciesTable).where(eq(routingPoliciesTable.userId, user.id)).limit(1))[0];
  if (!policy) {
    try {
      await db.insert(routingPoliciesTable).values({
        userId: user.id,
        mode: user.routingMode,
        weights: { quality: 0.3, reliability: 0.3, latency: 0.2, cost: 0.2 },
      });
    } catch {
      // Another request may have provisioned the policy concurrently.
    }
  }

  return {
    id: user.id,
    clerkUserId: user.clerkUserId,
    email: user.email,
    name: user.name,
    plan: user.plan,
    routingMode: user.routingMode as RoutingMode,
    createdAt: user.createdAt,
  };
}

export async function updateRoutingMode(clerkUserId: string, mode: RoutingMode): Promise<DbAccount> {
  const account = await ensureAccount(clerkUserId);
  await db.update(usersTable).set({ routingMode: mode, updatedAt: new Date() }).where(eq(usersTable.id, account.id));
  await db.update(routingPoliciesTable).set({ mode, updatedAt: new Date() }).where(eq(routingPoliciesTable.userId, account.id));
  return { ...account, routingMode: mode };
}

export async function listDeveloperKeys(clerkUserId: string) {
  const account = await ensureAccount(clerkUserId);
  return db.select().from(apiKeysTable).where(eq(apiKeysTable.userId, account.id)).orderBy(desc(apiKeysTable.createdAt));
}

export async function createDeveloperKey(clerkUserId: string, name: string) {
  const account = await ensureAccount(clerkUserId);
  const secret = `ek_live_${crypto.randomBytes(24).toString("hex")}`;
  const key = (await db.insert(apiKeysTable).values({
    userId: account.id,
    name,
    prefix: secret.slice(0, 14),
    secretHash: crypto.createHash("sha256").update(secret).digest("hex"),
  }).returning())[0];
  return { key, secret };
}

export async function authenticateDeveloperKey(secret: string): Promise<string | undefined> {
  const secretHash = crypto.createHash("sha256").update(secret).digest("hex");
  const row = (await db.select({
    clerkUserId: usersTable.clerkUserId,
    keyId: apiKeysTable.id,
  }).from(apiKeysTable)
    .innerJoin(usersTable, eq(usersTable.id, apiKeysTable.userId))
    .where(and(eq(apiKeysTable.secretHash, secretHash), isNull(apiKeysTable.revokedAt)))
    .limit(1))[0];
  if (!row) return undefined;
  await db.update(apiKeysTable).set({ lastUsedAt: new Date(), updatedAt: new Date() }).where(eq(apiKeysTable.id, row.keyId));
  return row.clerkUserId;
}

export async function revokeDeveloperKey(clerkUserId: string, id: string): Promise<boolean> {
  const account = await ensureAccount(clerkUserId);
  const updated = await db.update(apiKeysTable).set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, account.id), isNull(apiKeysTable.revokedAt)))
    .returning({ id: apiKeysTable.id });
  return updated.length > 0;
}

export async function getWallet(clerkUserId: string) {
  const account = await ensureAccount(clerkUserId);
  const wallet = (await db.select().from(walletsTable).where(eq(walletsTable.userId, account.id)).limit(1))[0];
  if (!wallet) throw new Error("WALLET_PROVISIONING_FAILED");
  const transactions = await db.select().from(walletTransactionsTable)
    .where(eq(walletTransactionsTable.walletId, wallet.id))
    .orderBy(desc(walletTransactionsTable.createdAt)).limit(50);
  return {
    balance: asNumber(wallet.balance),
    currency: wallet.currency,
    plan: account.plan,
    transactions,
  };
}

export async function chargeWallet(
  clerkUserId: string,
  units: number,
  description: string,
  requestId: string,
  idempotencyKey?: string,
) {
  const account = await ensureAccount(clerkUserId);
  return db.transaction(async (tx) => {
    const wallet = (await tx.select().from(walletsTable).where(eq(walletsTable.userId, account.id)).limit(1))[0];
    if (!wallet) throw new Error("WALLET_NOT_FOUND");
    if (idempotencyKey) {
      const existing = (await tx.select().from(walletTransactionsTable).where(and(
        eq(walletTransactionsTable.walletId, wallet.id),
        eq(walletTransactionsTable.idempotencyKey, idempotencyKey),
      )).limit(1))[0];
      if (existing) return existing;
    }
    const balance = asNumber(wallet.balance);
    if (units > balance) throw new Error("INSUFFICIENT_UNITS");
    const balanceAfter = balance - units;
    await tx.update(walletsTable).set({ balance: String(balanceAfter), updatedAt: new Date() }).where(eq(walletsTable.id, wallet.id));
    return (await tx.insert(walletTransactionsTable).values({
      walletId: wallet.id,
      type: "DEBIT",
      units: String(-units),
      balanceAfter: String(balanceAfter),
      description,
      requestId,
      idempotencyKey,
    }).returning())[0];
  });
}

export async function refundWallet(clerkUserId: string, units: number, description: string, requestId: string) {
  const account = await ensureAccount(clerkUserId);
  return db.transaction(async (tx) => {
    const wallet = (await tx.select().from(walletsTable).where(eq(walletsTable.userId, account.id)).limit(1))[0];
    if (!wallet) throw new Error("WALLET_NOT_FOUND");
    const balanceAfter = asNumber(wallet.balance) + units;
    await tx.update(walletsTable).set({ balance: String(balanceAfter), updatedAt: new Date() }).where(eq(walletsTable.id, wallet.id));
    return (await tx.insert(walletTransactionsTable).values({
      walletId: wallet.id,
      type: "REFUND",
      units: String(units),
      balanceAfter: String(balanceAfter),
      description,
      requestId,
    }).returning())[0];
  });
}

export async function getIdempotentRequest(clerkUserId: string, idempotencyKey: string) {
  const account = await ensureAccount(clerkUserId);
  return (await db.select().from(requestsTable).where(and(
    eq(requestsTable.userId, account.id),
    eq(requestsTable.idempotencyKey, idempotencyKey),
  )).limit(1))[0];
}

export async function createRequest(clerkUserId: string, data: {
  id: string;
  idempotencyKey?: string;
  capability: string;
  mode: RoutingMode;
  status: "completed" | "failed" | "processing";
  selectedModel?: string;
  selectedProvider?: string;
  inputHash: string;
  responseJson?: unknown;
}) {
  const account = await ensureAccount(clerkUserId);
  return (await db.insert(requestsTable).values({
    id: data.id,
    userId: account.id,
    idempotencyKey: data.idempotencyKey,
    capability: data.capability,
    mode: data.mode,
    status: data.status,
    selectedModel: data.selectedModel,
    selectedProvider: data.selectedProvider,
    inputHash: data.inputHash,
  }).onConflictDoUpdate({
    target: [requestsTable.userId, requestsTable.idempotencyKey],
    set: { status: data.status, selectedModel: data.selectedModel, selectedProvider: data.selectedProvider, responseJson: data.responseJson, updatedAt: new Date() },
  }).returning())[0];
}

export async function addAttempt(data: {
  requestId: string;
  provider: string;
  model: string;
  status: string;
  errorCode?: string;
  latencyMs?: number;
}) {
  await db.insert(requestAttemptsTable).values(data);
}

export async function addUsage(clerkUserId: string, data: {
  requestId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  units: number;
  providerCost: number;
  latencyMs: number;
}) {
  const account = await ensureAccount(clerkUserId);
  await db.insert(usageRecordsTable).values({
    requestId: data.requestId,
    userId: account.id,
    provider: data.provider,
    model: data.model,
    inputTokens: data.inputTokens,
    outputTokens: data.outputTokens,
    units: String(data.units),
    providerCost: String(data.providerCost),
    latencyMs: data.latencyMs,
  });
}

export async function listRequests(clerkUserId: string) {
  const account = await ensureAccount(clerkUserId);
  const rows = await db.select({
    id: requestsTable.id,
    capability: requestsTable.capability,
    model: requestsTable.selectedModel,
    provider: requestsTable.selectedProvider,
    status: requestsTable.status,
    units: sql<string>`coalesce(sum(${usageRecordsTable.units}), 0)`,
    latencyMs: sql<number>`coalesce(max(${usageRecordsTable.latencyMs}), 0)`,
    createdAt: requestsTable.createdAt,
  }).from(requestsTable)
    .leftJoin(usageRecordsTable, eq(usageRecordsTable.requestId, requestsTable.id))
    .where(eq(requestsTable.userId, account.id))
    .groupBy(requestsTable.id)
    .orderBy(desc(requestsTable.createdAt)).limit(100);
  return rows.map((row): DbRequestSummary => ({
    id: row.id,
    capability: row.capability,
    model: row.model ?? "unknown",
    provider: row.provider ?? "unknown",
    status: row.status as DbRequestSummary["status"],
    units: asNumber(row.units),
    latencyMs: Number(row.latencyMs ?? 0),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getUsage(clerkUserId: string, range: "7d" | "30d" | "90d") {
  const account = await ensureAccount(clerkUserId);
  const days = Number.parseInt(range, 10);
  const since = new Date(Date.now() - days * 86400000);
  const records = await db.select().from(usageRecordsTable)
    .where(and(eq(usageRecordsTable.userId, account.id), gte(usageRecordsTable.createdAt, since)))
    .orderBy(usageRecordsTable.createdAt);
  const points = new Map<string, { requests: number; units: number; cost: number }>();
  for (const record of records) {
    const date = record.createdAt.toISOString().slice(0, 10);
    const point = points.get(date) ?? { requests: 0, units: 0, cost: 0 };
    point.requests += 1;
    point.units += asNumber(record.units);
    point.cost += asNumber(record.providerCost);
    points.set(date, point);
  }
  return {
    total_requests: records.length,
    total_units: records.reduce((sum, item) => sum + asNumber(item.units), 0),
    total_cost: records.reduce((sum, item) => sum + asNumber(item.providerCost), 0),
    points: [...points.entries()].map(([date, point]) => ({ date, ...point })),
  };
}
