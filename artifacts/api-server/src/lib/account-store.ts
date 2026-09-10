import crypto from "node:crypto";
import type { RoutingMode } from "./routing";

export type Account = {
  id: string;
  clerkUserId: string;
  email: string;
  name: string;
  plan: string;
  routingMode: RoutingMode;
  createdAt: Date;
};

const accounts = new Map<string, Account>();
const apiKeys = new Map<string, { id: string; userId: string; name: string; prefix: string; secretHash: string; createdAt: Date; lastUsedAt: Date | null; revoked: boolean }[]>();

export function getAccount(clerkUserId: string): Account {
  const existing = accounts.get(clerkUserId);
  if (existing) return existing;
  const account: Account = {
    id: crypto.randomUUID(),
    clerkUserId,
    email: clerkUserId === "demo-user" ? "operator@ekyva.dev" : `${clerkUserId}@accounts.ekyva.dev`,
    name: clerkUserId === "demo-user" ? "EKYVA Operator" : "EKYVA User",
    plan: "Free",
    routingMode: "balanced",
    createdAt: new Date(),
  };
  accounts.set(clerkUserId, account);
  return account;
}

export function setRoutingMode(clerkUserId: string, mode: RoutingMode): Account {
  const account = getAccount(clerkUserId);
  account.routingMode = mode;
  return account;
}

export function listApiKeys(userId: string) {
  return apiKeys.get(userId) ?? [];
}

export function createApiKey(userId: string, name: string) {
  const secret = `ek_live_${crypto.randomBytes(24).toString("hex")}`;
  const key = {
    id: crypto.randomUUID(),
    userId,
    name,
    prefix: secret.slice(0, 14),
    secretHash: crypto.createHash("sha256").update(secret).digest("hex"),
    createdAt: new Date(),
    lastUsedAt: null,
    revoked: false,
  };
  apiKeys.set(userId, [key, ...(apiKeys.get(userId) ?? [])]);
  return { key, secret };
}

export function revokeApiKey(userId: string, id: string): boolean {
  const found = listApiKeys(userId).find((key) => key.id === id);
  if (!found) return false;
  found.revoked = true;
  return true;
}
