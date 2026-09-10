import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  ...timestamps,
});

export const usersTable = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkUserId: varchar("clerk_user_id", { length: 160 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  plan: varchar("plan", { length: 32 }).notNull().default("Free"),
  routingMode: varchar("routing_mode", { length: 16 }).notNull().default("balanced"),
  ...timestamps,
});

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizationsTable.id),
    userId: uuid("user_id").notNull().references(() => usersTable.id),
    role: varchar("role", { length: 32 }).notNull().default("member"),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] })],
);

export const walletsTable = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => usersTable.id),
  balance: numeric("balance", { precision: 18, scale: 6 }).notNull().default("0"),
  currency: varchar("currency", { length: 12 }).notNull().default("UU"),
  ...timestamps,
});

export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  walletId: uuid("wallet_id").notNull().references(() => walletsTable.id),
  type: varchar("type", { length: 16 }).notNull(),
  units: numeric("units", { precision: 18, scale: 6 }).notNull(),
  balanceAfter: numeric("balance_after", { precision: 18, scale: 6 }).notNull(),
  description: text("description").notNull(),
  requestId: uuid("request_id"),
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  ...timestamps,
});

export const apiKeysTable = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  name: varchar("name", { length: 60 }).notNull(),
  prefix: varchar("prefix", { length: 16 }).notNull(),
  secretHash: varchar("secret_hash", { length: 128 }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const providersTable = pgTable("providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: varchar("key", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  adapter: varchar("adapter", { length: 120 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const providerCredentialsTable = pgTable("provider_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id").notNull().references(() => providersTable.id),
  encryptedSecret: text("encrypted_secret").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  ...timestamps,
});

export const capabilitiesTable = pgTable("capabilities", {
  id: varchar("id", { length: 64 }).primaryKey(),
  label: varchar("label", { length: 120 }).notNull(),
  description: text("description").notNull(),
  ...timestamps,
});

export const providerModelsTable = pgTable("provider_models", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id").notNull().references(() => providersTable.id),
  modelKey: varchar("model_key", { length: 160 }).notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  qualityScore: numeric("quality_score", { precision: 5, scale: 2 }).notNull(),
  reliabilityScore: numeric("reliability_score", { precision: 5, scale: 2 }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 8 }).notNull(),
  contextWindow: integer("context_window"),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const modelCapabilitiesTable = pgTable(
  "model_capabilities",
  {
    modelId: uuid("model_id").notNull().references(() => providerModelsTable.id),
    capabilityId: varchar("capability_id", { length: 64 }).notNull().references(() => capabilitiesTable.id),
  },
  (table) => [primaryKey({ columns: [table.modelId, table.capabilityId] })],
);

export const routingPoliciesTable = pgTable("routing_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => usersTable.id),
  mode: varchar("mode", { length: 16 }).notNull().default("balanced"),
  weights: jsonb("weights").notNull(),
  ...timestamps,
});

export const providerHealthTable = pgTable("provider_health", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id").notNull().references(() => providersTable.id),
  status: varchar("status", { length: 16 }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  failureRate: numeric("failure_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const requestsTable = pgTable("requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  idempotencyKey: varchar("idempotency_key", { length: 128 }),
  capability: varchar("capability", { length: 64 }).notNull(),
  mode: varchar("mode", { length: 16 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  selectedModel: varchar("selected_model", { length: 160 }),
  selectedProvider: varchar("selected_provider", { length: 120 }),
  inputHash: varchar("input_hash", { length: 128 }).notNull(),
  ...timestamps,
});

export const requestAttemptsTable = pgTable("request_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => requestsTable.id),
  provider: varchar("provider", { length: 120 }).notNull(),
  model: varchar("model", { length: 160 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  errorCode: varchar("error_code", { length: 80 }),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageRecordsTable = pgTable("usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => requestsTable.id),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  provider: varchar("provider", { length: 120 }).notNull(),
  model: varchar("model", { length: 160 }).notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  units: numeric("units", { precision: 18, scale: 6 }).notNull(),
  providerCost: numeric("provider_cost", { precision: 18, scale: 8 }).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  ...timestamps,
});

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  plan: varchar("plan", { length: 32 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  unitsPerMonth: numeric("units_per_month", { precision: 18, scale: 6 }).notNull(),
  ...timestamps,
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  provider: varchar("provider", { length: 64 }).notNull(),
  externalId: varchar("external_id", { length: 160 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  currency: varchar("currency", { length: 12 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  ...timestamps,
});

export const auditLogsTable = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => usersTable.id),
  action: varchar("action", { length: 120 }).notNull(),
  resource: varchar("resource", { length: 160 }),
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 64 }),
  ...timestamps,
});

export const insertUserSchema = createInsertSchema(usersTable);
export const insertRequestSchema = createInsertSchema(requestsTable);
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type RequestRecord = typeof requestsTable.$inferSelect;