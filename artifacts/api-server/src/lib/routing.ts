import { allModels, type CapabilityId, type RegisteredModel } from "./providers";

export type RoutingMode = "economy" | "balanced" | "quality";

const weights: Record<RoutingMode, { quality: number; reliability: number; latency: number; cost: number }> = {
  economy: { quality: 0.15, reliability: 0.25, latency: 0.2, cost: 0.4 },
  balanced: { quality: 0.3, reliability: 0.3, latency: 0.2, cost: 0.2 },
  quality: { quality: 0.5, reliability: 0.3, latency: 0.05, cost: 0.15 },
};

function normalize(value: number, min: number, max: number): number {
  return max === min ? 1 : (value - min) / (max - min);
}

export function rankCandidates(capability: CapabilityId, mode: RoutingMode, models = allModels()): RegisteredModel[] {
  const eligible = models.filter(
    (model) => model.capabilities.includes(capability) && model.status !== "offline",
  );
  if (eligible.length < 1) return [];
  const costs = eligible.map((model) => model.unitCost);
  const latencies = eligible.map((model) => model.latencyMs);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);
  const selectedWeights = weights[mode];
  return eligible
    .map((model) => ({
      model,
      score:
        selectedWeights.quality * model.qualityScore +
        selectedWeights.reliability * model.reliability +
        selectedWeights.latency * (1 - normalize(model.latencyMs, minLatency, maxLatency)) +
        selectedWeights.cost * (1 - normalize(model.unitCost, minCost, maxCost)),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ model }) => model);
}
