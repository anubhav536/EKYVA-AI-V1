import crypto from "node:crypto";

export type CapabilityId =
  | "text.generate"
  | "text.reason"
  | "vision.analyze"
  | "image.generate"
  | "audio.transcribe"
  | "audio.generate"
  | "embeddings.create";

export type ProviderStatus = "healthy" | "degraded" | "offline";

export type RegisteredModel = {
  id: string;
  provider: string;
  displayName: string;
  capabilities: CapabilityId[];
  qualityScore: number;
  reliability: number;
  latencyMs: number;
  unitCost: number;
  contextWindow?: number;
  status: ProviderStatus;
};

export type GenerationRequest = {
  capability: CapabilityId;
  input: string;
  model: RegisteredModel;
  maxOutputTokens?: number | null;
  credential?: string;
};

export type GenerationResult = {
  output: string;
  inputTokens: number;
  outputTokens: number;
  providerCost: number;
};

export type ProviderAdapter = {
  key: string;
  name: string;
  listModels(): RegisteredModel[];
  getCapabilities(): CapabilityId[];
  healthCheck(): Promise<{ status: ProviderStatus; latencyMs: number }>;
  estimateCost(input: string, model: RegisteredModel): number;
  execute(request: GenerationRequest): Promise<GenerationResult>;
};

const providerModels: Record<string, Omit<RegisteredModel, "status">[]> = {
  openai: [
    {
      id: "gpt-5.6-terra",
      provider: "openai",
      displayName: "GPT-5.6 Terra",
      capabilities: ["text.generate", "text.reason", "vision.analyze"],
      qualityScore: 0.96,
      reliability: 0.985,
      latencyMs: 720,
      unitCost: 0.85,
      contextWindow: 128000,
    },
    {
      id: "gpt-5-mini",
      provider: "openai",
      displayName: "GPT-5 Mini",
      capabilities: ["text.generate", "vision.analyze"],
      qualityScore: 0.83,
      reliability: 0.99,
      latencyMs: 320,
      unitCost: 0.18,
      contextWindow: 128000,
    },
  ],
  anthropic: [
    {
      id: "claude-3-7-sonnet-latest",
      provider: "anthropic",
      displayName: "Claude 3.7 Sonnet",
      capabilities: ["text.generate", "text.reason", "vision.analyze"],
      qualityScore: 0.94,
      reliability: 0.98,
      latencyMs: 860,
      unitCost: 0.78,
      contextWindow: 200000,
    },
    {
      id: "claude-3-5-haiku-latest",
      provider: "anthropic",
      displayName: "Claude 3.5 Haiku",
      capabilities: ["text.generate", "vision.analyze"],
      qualityScore: 0.79,
      reliability: 0.988,
      latencyMs: 290,
      unitCost: 0.14,
      contextWindow: 200000,
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-flash",
      provider: "gemini",
      displayName: "Gemini 2.5 Flash",
      capabilities: ["text.generate", "text.reason", "vision.analyze", "embeddings.create"],
      qualityScore: 0.88,
      reliability: 0.985,
      latencyMs: 360,
      unitCost: 0.16,
      contextWindow: 1000000,
    },
  ],
  openrouter: [
    {
      id: "openai/gpt-4o-mini",
      provider: "openrouter",
      displayName: "OpenRouter · GPT-4o Mini",
      capabilities: ["text.generate", "text.reason", "vision.analyze"],
      qualityScore: 0.84,
      reliability: 0.97,
      latencyMs: 520,
      unitCost: 0.2,
      contextWindow: 128000,
    },
  ],
  mock: [
    {
      id: "ekyva-mock-v1",
      provider: "mock",
      displayName: "EKYVA Mock Provider",
      capabilities: ["text.generate", "text.reason", "vision.analyze", "image.generate", "embeddings.create"],
      qualityScore: 0.7,
      reliability: 1,
      latencyMs: 40,
      unitCost: 0.05,
      contextWindow: 32000,
    },
  ],
};

const providerStatusOverrides = new Map<string, ProviderStatus>();

export function setProviderStatus(provider: string, status: ProviderStatus) {
  providerStatusOverrides.set(provider, status);
}

function configured(provider: string): boolean {
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
  return process.env.EKYVA_ENABLE_MOCK_PROVIDER !== "false";
}

function modelStatus(provider: string): ProviderStatus {
  return providerStatusOverrides.get(provider) ?? (configured(provider) ? "healthy" : "degraded");
}

class OpenAIAdapter implements ProviderAdapter {
  key = "openai";
  name = "OpenAI";

  listModels() {
    return providerModels.openai.map((model) => ({ ...model, status: modelStatus(this.key) }));
  }

  getCapabilities() {
    return ["text.generate", "text.reason", "vision.analyze"] as CapabilityId[];
  }

  async healthCheck() {
    const started = Date.now();
    if (!configured(this.key)) return { status: "degraded" as const, latencyMs: Date.now() - started };
    try {
      const response = await fetch(`${process.env.EKYVA_OPENAI_BASE_URL ?? "https://api.openai.com"}/v1/models`, {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(2500),
      });
      return {
        status: (response.ok ? "healthy" : "degraded") as ProviderStatus,
        latencyMs: Date.now() - started,
      };
    } catch {
      return { status: "offline" as const, latencyMs: Date.now() - started };
    }
  }

  estimateCost(input: string, model: RegisteredModel) {
    return Math.max(1, Math.ceil((input.length / 4) * model.unitCost));
  }

  async execute(request: GenerationRequest): Promise<GenerationResult> {
    const credential = request.credential ?? process.env.OPENAI_API_KEY;
    if (!credential) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "OpenAI credentials are not configured", false);
    const baseUrl = process.env.EKYVA_OPENAI_BASE_URL ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({
        model: request.model.id,
        messages: [{ role: "user", content: request.input }],
        max_completion_tokens: request.maxOutputTokens ?? 1024,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`PROVIDER_HTTP_${response.status}`, `OpenAI returned ${response.status}`, retryable);
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const output = body.choices?.[0]?.message?.content;
    if (!output) throw new ProviderError("EMPTY_PROVIDER_RESPONSE", "Provider returned an empty response", true);
    const inputTokens = body.usage?.prompt_tokens ?? Math.ceil(request.input.length / 4);
    const outputTokens = body.usage?.completion_tokens ?? Math.ceil(output.length / 4);
    return {
      output,
      inputTokens,
      outputTokens,
      providerCost: (inputTokens + outputTokens) * request.model.unitCost / 1000,
    };
  }
}

class AnthropicAdapter implements ProviderAdapter {
  key = "anthropic";
  name = "Anthropic";

  listModels() {
    return providerModels.anthropic.map((model) => ({ ...model, status: modelStatus(this.key) }));
  }

  getCapabilities() {
    return ["text.generate", "text.reason", "vision.analyze"] as CapabilityId[];
  }

  async healthCheck() {
    return configured(this.key)
      ? { status: "healthy" as const, latencyMs: 640 }
      : { status: "degraded" as const, latencyMs: 0 };
  }

  estimateCost(input: string, model: RegisteredModel) {
    return Math.max(1, Math.ceil((input.length / 4) * model.unitCost));
  }

  async execute(request: GenerationRequest): Promise<GenerationResult> {
    const credential = request.credential ?? process.env.ANTHROPIC_API_KEY;
    if (!credential) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Anthropic credentials are not configured", false);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credential,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model.id,
        max_tokens: request.maxOutputTokens ?? 1024,
        messages: [{ role: "user", content: request.input }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(`PROVIDER_HTTP_${response.status}`, `Anthropic returned ${response.status}`, retryable);
    }
    const body = (await response.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const output = body.content?.find((item) => item.type === "text")?.text;
    if (!output) throw new ProviderError("EMPTY_PROVIDER_RESPONSE", "Provider returned an empty response", true);
    const inputTokens = body.usage?.input_tokens ?? Math.ceil(request.input.length / 4);
    const outputTokens = body.usage?.output_tokens ?? Math.ceil(output.length / 4);
    return {
      output,
      inputTokens,
      outputTokens,
      providerCost: (inputTokens + outputTokens) * request.model.unitCost / 1000,
    };
  }
}

export class ProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "ProviderError";
  }
}

class GeminiAdapter implements ProviderAdapter {
  key = "gemini";
  name = "Google Gemini";

  listModels() {
    return providerModels.gemini.map((model) => ({ ...model, status: modelStatus(this.key) }));
  }

  getCapabilities() {
    return providerModels.gemini[0].capabilities;
  }

  async healthCheck() {
    return configured(this.key) ? { status: "healthy" as const, latencyMs: 480 } : { status: "degraded" as const, latencyMs: 0 };
  }

  estimateCost(input: string, model: RegisteredModel) {
    return Math.max(1, Math.ceil((input.length / 4) * model.unitCost));
  }

  async execute(request: GenerationRequest): Promise<GenerationResult> {
    const credential = request.credential ?? process.env.GEMINI_API_KEY;
    if (!credential) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Gemini credentials are not configured", false);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model.id)}:generateContent?key=${encodeURIComponent(credential)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: request.input }] }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new ProviderError(`PROVIDER_HTTP_${response.status}`, `Gemini returned ${response.status}`, response.status === 429 || response.status >= 500);
    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    const output = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!output) throw new ProviderError("EMPTY_PROVIDER_RESPONSE", "Gemini returned an empty response", true);
    const inputTokens = body.usageMetadata?.promptTokenCount ?? Math.ceil(request.input.length / 4);
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? Math.ceil(output.length / 4);
    return { output, inputTokens, outputTokens, providerCost: (inputTokens + outputTokens) * request.model.unitCost / 1000 };
  }
}

class OpenRouterAdapter implements ProviderAdapter {
  key = "openrouter";
  name = "OpenRouter";

  listModels() {
    return providerModels.openrouter.map((model) => ({ ...model, status: modelStatus(this.key) }));
  }

  getCapabilities() {
    return providerModels.openrouter[0].capabilities;
  }

  async healthCheck() {
    return configured(this.key) ? { status: "healthy" as const, latencyMs: 520 } : { status: "degraded" as const, latencyMs: 0 };
  }

  estimateCost(input: string, model: RegisteredModel) {
    return Math.max(1, Math.ceil((input.length / 4) * model.unitCost));
  }

  async execute(request: GenerationRequest): Promise<GenerationResult> {
    const credential = request.credential ?? process.env.OPENROUTER_API_KEY;
    if (!credential) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "OpenRouter credentials are not configured", false);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
        "HTTP-Referer": process.env.EKYVA_PUBLIC_URL ?? "http://localhost",
        "X-Title": "EKYVA AI",
      },
      body: JSON.stringify({ model: request.model.id, messages: [{ role: "user", content: request.input }], max_tokens: request.maxOutputTokens ?? 1024 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new ProviderError(`PROVIDER_HTTP_${response.status}`, `OpenRouter returned ${response.status}`, response.status === 429 || response.status >= 500);
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const output = body.choices?.[0]?.message?.content;
    if (!output) throw new ProviderError("EMPTY_PROVIDER_RESPONSE", "OpenRouter returned an empty response", true);
    const inputTokens = body.usage?.prompt_tokens ?? Math.ceil(request.input.length / 4);
    const outputTokens = body.usage?.completion_tokens ?? Math.ceil(output.length / 4);
    return { output, inputTokens, outputTokens, providerCost: (inputTokens + outputTokens) * request.model.unitCost / 1000 };
  }
}

class MockAdapter implements ProviderAdapter {
  key = "mock";
  name = "EKYVA Mock Provider";

  listModels() {
    return providerModels.mock.map((model) => ({ ...model, status: "healthy" as const }));
  }

  getCapabilities() {
    return providerModels.mock[0].capabilities;
  }

  async healthCheck() {
    return { status: "healthy" as const, latencyMs: 5 };
  }

  estimateCost(input: string, model: RegisteredModel) {
    return Math.max(1, Math.ceil((input.length / 4) * model.unitCost));
  }

  async execute(request: GenerationRequest): Promise<GenerationResult> {
    const inputTokens = Math.max(1, Math.ceil(request.input.length / 4));
    const output = request.capability === "embeddings.create"
      ? JSON.stringify({ embedding: Array.from({ length: 8 }, (_, index) => Number(((inputTokens + index) / 100).toFixed(4))) })
      : request.capability === "image.generate"
        ? `Mock image generated for: ${request.input}`
        : `Mock response from EKYVA. I received your ${request.capability} request: ${request.input}`;
    const outputTokens = Math.max(1, Math.ceil(output.length / 4));
    return { output, inputTokens, outputTokens, providerCost: (inputTokens + outputTokens) * request.model.unitCost / 1000 };
  }
}

export const providerAdapters: ProviderAdapter[] = [
  new OpenAIAdapter(),
  new AnthropicAdapter(),
  new GeminiAdapter(),
  new OpenRouterAdapter(),
  new MockAdapter(),
];

export function allModels(): RegisteredModel[] {
  return providerAdapters.flatMap((adapter) => adapter.listModels());
}

export function findAdapter(provider: string): ProviderAdapter | undefined {
  return providerAdapters.find((adapter) => adapter.key === provider);
}

export function requestFingerprint(userId: string, input: string, capability: string): string {
  return crypto.createHash("sha256").update(`${userId}:${capability}:${input}`).digest("hex");
}
