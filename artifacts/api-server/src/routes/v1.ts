import crypto from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import {
  CreateApiKeyBody,
  CreateApiKeyResponse,
  DeleteApiKeyParams,
  GenerateBody,
  GenerateResponse,
  GetAdminOverviewResponse,
  GetCurrentUserResponse,
  GetDashboardSummaryResponse,
  GetUsageQueryParams,
  GetUsageResponse,
  GetWalletResponse,
  ListApiKeysResponse,
  ListCapabilitiesResponse,
  ListModelsResponse,
  ListRequestsResponse,
  UpdateRoutingModeBody,
  UpdateRoutingModeResponse,
} from "@workspace/api-zod";
import { requireAdmin, requireEkyvaAuth } from "../middlewares/auth";
import { rateLimit } from "../middlewares/rate-limit";
import { getAccount, createApiKey, listApiKeys, revokeApiKey, setRoutingMode } from "../lib/account-store";
import { allModels, findAdapter, providerAdapters, ProviderError, requestFingerprint, type CapabilityId } from "../lib/providers";
import { rankCandidates, type RoutingMode } from "../lib/routing";
import { addRequest, getRequests } from "../lib/request-store";
import { chargeWallet, getWalletState } from "../lib/wallet";

const router: IRouter = Router();
const idempotentResponses = new Map<string, ReturnType<typeof GenerateResponse.parse>>();

const capabilityDefinitions: Record<CapabilityId, { label: string; description: string }> = {
  "text.generate": { label: "Text generation", description: "Draft, summarize, transform, and complete text." },
  "text.reason": { label: "Reasoning", description: "Work through complex multi-step questions and decisions." },
  "vision.analyze": { label: "Vision analysis", description: "Understand images alongside natural language prompts." },
  "image.generate": { label: "Image generation", description: "Generate images from natural language prompts." },
  "audio.transcribe": { label: "Audio transcription", description: "Turn spoken audio into searchable text." },
  "audio.generate": { label: "Audio generation", description: "Create speech and audio from text." },
  "embeddings.create": { label: "Embeddings", description: "Create vectors for semantic search and retrieval." },
};

function accountFor(req: Request) {
  return getAccount(req.ekyvaUserId ?? "demo-user");
}

function userPayload(req: Request) {
  const account = accountFor(req);
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    plan: account.plan,
    routing_mode: account.routingMode,
    created_at: account.createdAt,
  };
}

router.use(requireEkyvaAuth);
router.use("/v1/ai/generate", rateLimit({ limit: 60, windowSeconds: 60 }));

router.get("/v1/auth/me", (req, res) => {
  res.json(GetCurrentUserResponse.parse(userPayload(req)));
});

router.get("/v1/models", (_req, res) => {
  const payload = allModels().map((model) => ({
    id: model.id,
    provider: model.provider,
    display_name: model.displayName,
    capabilities: model.capabilities,
    quality_score: model.qualityScore,
    reliability: model.reliability,
    latency_ms: model.latencyMs,
    unit_cost: model.unitCost,
    status: model.status,
    context_window: model.contextWindow,
  }));
  res.json(ListModelsResponse.parse(payload));
});

router.get("/v1/capabilities", (_req, res) => {
  const models = allModels();
  const payload = Object.entries(capabilityDefinitions).map(([id, definition]) => ({
    id,
    ...definition,
    model_count: models.filter((model) => model.capabilities.includes(id as CapabilityId)).length,
  }));
  res.json(ListCapabilitiesResponse.parse(payload));
});

router.get("/v1/wallet", (req, res) => {
  const account = accountFor(req);
  const wallet = getWalletState(req.ekyvaUserId ?? "demo-user");
  const payload = {
    balance: wallet.balance,
    currency: "UU",
    plan: account.plan,
    transactions: wallet.entries.slice(0, 8).map((entry) => ({
      id: entry.id,
      type: entry.type,
      units: entry.units,
      description: entry.description,
      created_at: entry.createdAt,
    })),
  };
  res.json(GetWalletResponse.parse(payload));
});

router.get("/v1/api-keys", (req, res) => {
  const payload = listApiKeys(req.ekyvaUserId ?? "demo-user").map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last_used_at: key.lastUsedAt,
    created_at: key.createdAt,
    status: key.revoked ? "revoked" : "active",
  }));
  res.json(ListApiKeysResponse.parse(payload));
});

router.post("/v1/api-keys", (req, res) => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const { key, secret } = createApiKey(req.ekyvaUserId ?? "demo-user", parsed.data.name);
  res.status(201).json(CreateApiKeyResponse.parse({ id: key.id, name: key.name, key: secret }));
});

router.delete("/v1/api-keys/:id", (req, res) => {
  const parsed = DeleteApiKeyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const revoked = revokeApiKey(req.ekyvaUserId ?? "demo-user", parsed.data.id);
  if (!revoked) {
    res.status(404).json({ error: "API key not found", code: "NOT_FOUND" });
    return;
  }
  res.status(204).send();
});

router.patch("/v1/routing/mode", (req, res) => {
  const parsed = UpdateRoutingModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const account = setRoutingMode(req.ekyvaUserId ?? "demo-user", parsed.data.mode as RoutingMode);
  res.json(UpdateRoutingModeResponse.parse({ mode: account.routingMode }));
});

router.get("/v1/requests", (req, res) => {
  const payload = getRequests(req.ekyvaUserId ?? "demo-user").map((item) => ({
    id: item.id,
    capability: item.capability,
    model: item.model,
    provider: item.provider,
    status: item.status,
    units: item.units,
    latency_ms: item.latencyMs,
    created_at: item.createdAt,
  }));
  res.json(ListRequestsResponse.parse(payload));
});

router.get("/v1/usage", (req, res) => {
  const query = GetUsageQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message, code: "INVALID_INPUT" });
    return;
  }
  const entries = getRequests(req.ekyvaUserId ?? "demo-user").filter((item) => item.status === "completed");
  const totalUnits = entries.reduce((sum, item) => sum + item.units, 0);
  const points = new Map<string, { requests: number; units: number; cost: number }>();
  for (const entry of entries) {
    const date = entry.createdAt.slice(0, 10);
    const point = points.get(date) ?? { requests: 0, units: 0, cost: 0 };
    point.requests += 1;
    point.units += entry.units;
    point.cost += entry.units * 0.002;
    points.set(date, point);
  }
  res.json(GetUsageResponse.parse({
    total_requests: entries.length,
    total_units: totalUnits,
    total_cost: entries.reduce((sum, item) => sum + item.units * 0.002, 0),
    points: [...points.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, point]) => ({ date, ...point })),
  }));
});

router.get("/v1/dashboard/summary", (req, res) => {
  const entries = getRequests(req.ekyvaUserId ?? "demo-user");
  const completed = entries.filter((entry) => entry.status === "completed");
  const wallet = getWalletState(req.ekyvaUserId ?? "demo-user");
  const healthyProviders = providerAdapters.length;
  res.json(GetDashboardSummaryResponse.parse({
    wallet_balance: wallet.balance,
    monthly_units: completed.reduce((sum, entry) => sum + entry.units, 0),
    monthly_requests: completed.length,
    success_rate: entries.length ? completed.length / entries.length : 1,
    avg_latency_ms: completed.length ? Math.round(completed.reduce((sum, entry) => sum + entry.latencyMs, 0) / completed.length) : 0,
    active_models: allModels().length,
    healthy_providers: healthyProviders,
    routing_mode: accountFor(req).routingMode,
  }));
});

router.get("/v1/admin/overview", requireAdmin, (req, res) => {
  const entries = getRequests(req.ekyvaUserId ?? "demo-user");
  res.json(GetAdminOverviewResponse.parse({
    providers: providerAdapters.length,
    healthy_providers: providerAdapters.length,
    requests_today: entries.length,
    units_today: entries.reduce((sum, entry) => sum + entry.units, 0),
  }));
});

router.post("/v1/ai/generate", async (req, res): Promise<void> => {
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const clerkUserId = req.ekyvaUserId ?? "demo-user";
  const account = accountFor(req);
  const mode = (parsed.data.mode ?? account.routingMode) as RoutingMode;
  const idempotencyKey = typeof req.header("Idempotency-Key") === "string" ? req.header("Idempotency-Key")! : undefined;
  const fingerprint = idempotencyKey ? `${clerkUserId}:${idempotencyKey}` : undefined;
  if (fingerprint && idempotentResponses.has(fingerprint)) {
    res.json(idempotentResponses.get(fingerprint));
    return;
  }

  const requestedModels = parsed.data.model
    ? allModels().filter((model) => model.id === parsed.data.model)
    : allModels();
  const candidates = rankCandidates(parsed.data.capability as CapabilityId, mode, requestedModels);
  if (candidates.length === 0) {
    res.status(503).json({ error: "No capable provider is currently available", code: "NO_PROVIDER_AVAILABLE" });
    return;
  }

  const requestId = crypto.randomUUID();
  const started = Date.now();
  let attempts = 0;
  let lastError: ProviderError | undefined;
  for (const model of candidates) {
    const adapter = findAdapter(model.provider);
    if (!adapter) continue;
    attempts += 1;
    try {
      const result = await adapter.execute({
        capability: parsed.data.capability as CapabilityId,
        input: parsed.data.input,
        model,
        maxOutputTokens: parsed.data.max_output_tokens,
      });
      const units = Math.max(1, Math.ceil(((result.inputTokens + result.outputTokens) / 1000) * model.unitCost));
      try {
        chargeWallet(clerkUserId, units, `${model.displayName} generation`);
      } catch {
        res.status(402).json({ error: "Insufficient Universal Units", code: "INSUFFICIENT_UNITS" });
        return;
      }
      const response = GenerateResponse.parse({
        id: requestId,
        output: result.output,
        model: model.id,
        provider: model.provider,
        units,
        latency_ms: Date.now() - started,
        attempts,
      });
      addRequest(clerkUserId, {
        id: requestId,
        capability: parsed.data.capability,
        model: model.id,
        provider: model.provider,
        status: "completed",
        units,
        latencyMs: Date.now() - started,
        createdAt: new Date().toISOString(),
      });
      if (fingerprint) idempotentResponses.set(fingerprint, response);
      res.json(response);
      return;
    } catch (error) {
      if (error instanceof ProviderError) {
        lastError = error;
        if (!error.retryable) continue;
      }
    }
  }
  addRequest(clerkUserId, {
    id: requestId,
    capability: parsed.data.capability,
    model: candidates[0]?.id ?? "unknown",
    provider: candidates[0]?.provider ?? "unknown",
    status: "failed",
    units: 0,
    latencyMs: Date.now() - started,
    createdAt: new Date().toISOString(),
  });
  res.status(503).json({
    error: lastError?.message ?? "All provider attempts failed",
    code: lastError?.code ?? "ALL_PROVIDERS_FAILED",
  });
});

export default router;
