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
};

function configured(provider: string): boolean {
  return provider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.ANTHROPIC_API_KEY);
}

function modelStatus(provider: string): ProviderStatus {
  return configured(provider) ? "healthy" : "degraded";
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
    if (!configured(this.key)) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "OpenAI credentials are not configured", false);
    const baseUrl = process.env.EKYVA_OPENAI_BASE_URL ?? "https://api.openai.com";
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
    if (!configured(this.key)) throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Anthropic credentials are not configured", false);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
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

export const providerAdapters: ProviderAdapter[] = [new OpenAIAdapter(), new AnthropicAdapter()];

export function allModels(): RegisteredModel[] {
  return providerAdapters.flatMap((adapter) => adapter.listModels());
}

export function findAdapter(provider: string): ProviderAdapter | undefined {
  return providerAdapters.find((adapter) => adapter.key === provider);
}

export function requestFingerprint(userId: string, input: string, capability: string): string {
  return crypto.createHash("sha256").update(`${userId}:${capability}:${input}`).digest("hex");
}
