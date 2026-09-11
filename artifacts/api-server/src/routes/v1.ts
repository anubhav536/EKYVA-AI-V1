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
import { allModels, findAdapter, providerAdapters, ProviderError, requestFingerprint, type CapabilityId } from "../lib/providers";
import { rankCandidates, type RoutingMode } from "../lib/routing";
import {
  addAttempt,
  addUsage,
  chargeWallet,
  createDeveloperKey,
  createRequest,
  ensureAccount,
  getIdempotentRequest,
  getUsage,
  getWallet,
  listDeveloperKeys,
  listRequests,
  revokeDeveloperKey,
  updateRoutingMode,
} from "../lib/db-store";
import { getProviderCredential, listProviderCredentials, saveProviderCredential, deleteProviderCredential } from "../lib/provider-credentials";

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
  return ensureAccount(req.ekyvaUserId ?? "demo-user");
}

async function userPayload(req: Request) {
  const account = await accountFor(req);
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

router.get("/v1/provider-keys", async (req, res) => {
  res.json((await listProviderCredentials(req.ekyvaUserId ?? "demo-user")).map((item) => ({
    provider: item.provider,
    configured_at: item.configuredAt.toISOString(),
    status: "configured",
  })));
});

router.put("/v1/provider-keys/:provider", async (req, res) => {
  const secret = typeof req.body?.secret === "string" ? req.body.secret.trim() : "";
  if (!secret || secret.length < 10 || secret.length > 500) {
    res.status(400).json({ error: "A valid provider secret is required", code: "INVALID_INPUT" });
    return;
  }
  const provider = req.params.provider;
  if (!["openai", "gemini", "anthropic", "openrouter"].includes(provider)) {
    res.status(400).json({ error: "Unsupported provider", code: "INVALID_PROVIDER" });
    return;
  }
  await saveProviderCredential(req.ekyvaUserId ?? "demo-user", provider, secret);
  res.status(204).send();
});

router.delete("/v1/provider-keys/:provider", async (req, res) => {
  await deleteProviderCredential(req.ekyvaUserId ?? "demo-user", req.params.provider);
  res.status(204).send();
});

router.get("/v1/auth/me", async (req, res) => {
  res.json(GetCurrentUserResponse.parse(await userPayload(req)));
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

router.get("/v1/wallet", async (req, res) => {
  const account = await accountFor(req);
  const wallet = await getWallet(req.ekyvaUserId ?? "demo-user");
  const payload = {
    balance: wallet.balance,
    currency: "UU",
    plan: account.plan,
    transactions: wallet.transactions.slice(0, 8).map((entry) => ({
      id: entry.id,
      type: entry.type,
      units: entry.units,
      description: entry.description,
      created_at: entry.createdAt,
    })),
  };
  res.json(GetWalletResponse.parse(payload));
});

router.get(["/v1/api-keys", "/v1/keys"], async (req, res) => {
  const payload = (await listDeveloperKeys(req.ekyvaUserId ?? "demo-user")).map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    last_used_at: key.lastUsedAt?.toISOString() ?? null,
    created_at: key.createdAt,
    status: key.revokedAt ? "revoked" : "active",
  }));
  res.json(ListApiKeysResponse.parse(payload));
});

router.post(["/v1/api-keys", "/v1/keys"], async (req, res) => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const { key, secret } = await createDeveloperKey(req.ekyvaUserId ?? "demo-user", parsed.data.name);
  res.status(201).json(CreateApiKeyResponse.parse({ id: key.id, name: key.name, key: secret }));
});

router.delete(["/v1/api-keys/:id", "/v1/keys/:id"], async (req, res) => {
  const parsed = DeleteApiKeyParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const revoked = await revokeDeveloperKey(req.ekyvaUserId ?? "demo-user", parsed.data.id);
  if (!revoked) {
    res.status(404).json({ error: "API key not found", code: "NOT_FOUND" });
    return;
  }
  res.status(204).send();
});

router.patch("/v1/routing/mode", async (req, res) => {
  const parsed = UpdateRoutingModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message, code: "INVALID_INPUT" });
    return;
  }
  const account = await updateRoutingMode(req.ekyvaUserId ?? "demo-user", parsed.data.mode as RoutingMode);
  res.json(UpdateRoutingModeResponse.parse({ mode: account.routingMode }));
});

router.get("/v1/requests", async (req, res) => {
  const payload = (await listRequests(req.ekyvaUserId ?? "demo-user")).map((item) => ({
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

router.get("/v1/usage", async (req, res) => {
  const query = GetUsageQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message, code: "INVALID_INPUT" });
    return;
  }
  res.json(GetUsageResponse.parse(await getUsage(req.ekyvaUserId ?? "demo-user", query.data.range ?? "30d")));
});

router.get("/v1/dashboard/summary", async (req, res) => {
  const entries = await listRequests(req.ekyvaUserId ?? "demo-user");
  const completed = entries.filter((entry) => entry.status === "completed");
  const wallet = await getWallet(req.ekyvaUserId ?? "demo-user");
  const healthyProviders = allModels().filter((model) => model.status === "healthy").map((model) => model.provider).filter((provider, index, list) => list.indexOf(provider) === index).length;
  const account = await accountFor(req);
  res.json(GetDashboardSummaryResponse.parse({
    wallet_balance: wallet.balance,
    monthly_units: completed.reduce((sum, entry) => sum + entry.units, 0),
    monthly_requests: completed.length,
    success_rate: entries.length ? completed.length / entries.length : 1,
    avg_latency_ms: completed.length ? Math.round(completed.reduce((sum, entry) => sum + entry.latencyMs, 0) / completed.length) : 0,
    active_models: allModels().length,
    healthy_providers: healthyProviders,
    routing_mode: account.routingMode,
  }));
});

router.get("/v1/admin/overview", requireAdmin, async (req, res) => {
  const entries = await listRequests(req.ekyvaUserId ?? "demo-user");
  res.json(GetAdminOverviewResponse.parse({
    providers: providerAdapters.length,
    healthy_providers: allModels().filter((model) => model.status === "healthy").map((model) => model.provider).filter((provider, index, list) => list.indexOf(provider) === index).length,
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
  const account = await accountFor(req);
  const mode = (parsed.data.mode ?? account.routingMode) as RoutingMode;
  const idempotencyKey = typeof req.header("Idempotency-Key") === "string" ? req.header("Idempotency-Key")! : undefined;
  const fingerprint = idempotencyKey ? `${clerkUserId}:${idempotencyKey}` : undefined;
  if (fingerprint) {
    const existing = await getIdempotentRequest(clerkUserId, idempotencyKey!);
    if (existing?.status === "completed" && existing.responseJson) {
      res.json(existing.responseJson);
      return;
    }
    if (idempotentResponses.has(fingerprint)) {
      res.json(idempotentResponses.get(fingerprint));
      return;
    }
  }
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
  await createRequest(clerkUserId, {
    id: requestId,
    idempotencyKey,
    capability: parsed.data.capability,
    mode,
    status: "processing",
    inputHash: requestFingerprint(clerkUserId, parsed.data.input, parsed.data.capability),
  });
  let attempts = 0;
  let lastError: ProviderError | undefined;
  for (const model of candidates) {
    const adapter = findAdapter(model.provider);
    if (!adapter) continue;
    attempts += 1;
    const attemptStarted = Date.now();
    try {
      const result = await adapter.execute({
        capability: parsed.data.capability as CapabilityId,
        input: parsed.data.input,
        model,
        maxOutputTokens: parsed.data.max_output_tokens,
        credential: await getProviderCredential(clerkUserId, model.provider),
      });
      const units = Math.max(1, Math.ceil(((result.inputTokens + result.outputTokens) / 1000) * model.unitCost));
      try {
        await chargeWallet(clerkUserId, units, `${model.displayName} generation`, requestId, idempotencyKey);
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
      await addAttempt({ requestId, provider: model.provider, model: model.id, status: "completed", latencyMs: Date.now() - attemptStarted });
      await addUsage(clerkUserId, {
        requestId,
        provider: model.provider,
        model: model.id,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        units,
        providerCost: result.providerCost,
        latencyMs: Date.now() - started,
      });
      await createRequest(clerkUserId, {
        id: requestId,
        idempotencyKey,
        capability: parsed.data.capability,
        mode,
        status: "completed",
        selectedModel: model.id,
        selectedProvider: model.provider,
        inputHash: requestFingerprint(clerkUserId, parsed.data.input, parsed.data.capability),
        responseJson: response,
      });
      if (fingerprint) idempotentResponses.set(fingerprint, response);
      res.json(response);
      return;
    } catch (error) {
      if (error instanceof ProviderError) {
        lastError = error;
        await addAttempt({ requestId, provider: model.provider, model: model.id, status: "failed", errorCode: error.code, latencyMs: Date.now() - attemptStarted });
        if (!error.retryable) continue;
      }
    }
  }
  await createRequest(clerkUserId, {
    id: requestId,
    idempotencyKey,
    capability: parsed.data.capability,
    mode,
    status: "failed",
    selectedModel: candidates[0]?.id ?? "unknown",
    selectedProvider: candidates[0]?.provider ?? "unknown",
    inputHash: requestFingerprint(clerkUserId, parsed.data.input, parsed.data.capability),
  });
  res.status(503).json({
    error: lastError?.message ?? "All provider attempts failed",
    code: lastError?.code ?? "ALL_PROVIDERS_FAILED",
  });
});

export default router;
