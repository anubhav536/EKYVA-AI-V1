import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, providerCredentialsTable, providersTable } from "@workspace/db";
import { ensureAccount } from "./db-store";

const algorithm = "aes-256-gcm";

function encryptionKey(): Buffer {
  const configured = process.env.EKYVA_CREDENTIAL_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("EKYVA_CREDENTIAL_ENCRYPTION_KEY is required in production");
  return crypto.createHash("sha256").update(configured ?? "ekyva-development-only-key").digest();
}

function encrypt(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

async function providerId(provider: string) {
  return (await db.select({ id: providersTable.id }).from(providersTable).where(eq(providersTable.key, provider)).limit(1))[0]?.id;
}

export async function listProviderCredentials(clerkUserId: string) {
  const account = await ensureAccount(clerkUserId);
  return db.select({
    provider: providersTable.key,
    configuredAt: providerCredentialsTable.createdAt,
  }).from(providerCredentialsTable)
    .innerJoin(providersTable, eq(providersTable.id, providerCredentialsTable.providerId))
    .where(eq(providerCredentialsTable.userId, account.id));
}

export async function getProviderCredential(clerkUserId: string, provider: string) {
  const account = await ensureAccount(clerkUserId);
  const id = await providerId(provider);
  if (!id) return undefined;
  const row = (await db.select({ encryptedSecret: providerCredentialsTable.encryptedSecret })
    .from(providerCredentialsTable)
    .where(and(eq(providerCredentialsTable.userId, account.id), eq(providerCredentialsTable.providerId, id)))
    .limit(1))[0];
  return row ? decrypt(row.encryptedSecret) : undefined;
}

export async function saveProviderCredential(clerkUserId: string, provider: string, secret: string) {
  const account = await ensureAccount(clerkUserId);
  const id = await providerId(provider);
  if (!id) throw new Error("PROVIDER_NOT_FOUND");
  await db.insert(providerCredentialsTable).values({
    userId: account.id,
    providerId: id,
    encryptedSecret: encrypt(secret),
  }).onConflictDoUpdate({
    target: [providerCredentialsTable.userId, providerCredentialsTable.providerId],
    set: { encryptedSecret: encrypt(secret), updatedAt: new Date() },
  });
}

export async function deleteProviderCredential(clerkUserId: string, provider: string) {
  const account = await ensureAccount(clerkUserId);
  const id = await providerId(provider);
  if (!id) return false;
  const deleted = await db.delete(providerCredentialsTable)
    .where(and(eq(providerCredentialsTable.userId, account.id), eq(providerCredentialsTable.providerId, id)))
    .returning({ id: providerCredentialsTable.id });
  return deleted.length > 0;
}