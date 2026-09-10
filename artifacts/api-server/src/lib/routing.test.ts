import assert from "node:assert/strict";
import test from "node:test";
import { rankCandidates } from "./routing";
import type { RegisteredModel } from "./providers";

const models: RegisteredModel[] = [
  {
    id: "cheap-fast",
    provider: "one",
    displayName: "Cheap Fast",
    capabilities: ["text.generate"],
    qualityScore: 0.6,
    reliability: 0.9,
    latencyMs: 120,
    unitCost: 0.1,
    status: "healthy",
  },
  {
    id: "premium-slow",
    provider: "two",
    displayName: "Premium Slow",
    capabilities: ["text.generate"],
    qualityScore: 0.98,
    reliability: 0.99,
    latencyMs: 900,
    unitCost: 0.9,
    status: "healthy",
  },
  {
    id: "offline",
    provider: "three",
    displayName: "Offline",
    capabilities: ["text.generate"],
    qualityScore: 1,
    reliability: 1,
    latencyMs: 1,
    unitCost: 0,
    status: "offline",
  },
];

test("routing filters offline models and favors economy candidates", () => {
  const candidates = rankCandidates("text.generate", "economy", models);
  assert.deepEqual(candidates.map((model) => model.id), ["cheap-fast", "premium-slow"]);
});

test("quality mode favors model quality over cost", () => {
  const candidates = rankCandidates("text.generate", "quality", models);
  assert.equal(candidates[0]?.id, "premium-slow");
});

test("routing filters by capability", () => {
  assert.deepEqual(rankCandidates("audio.transcribe", "balanced", models), []);
});
