import { db, capabilitiesTable, providersTable, providerModelsTable } from "./src";

const capabilities = [
  ["text.generate", "Text generation", "Draft, summarize, transform, and complete text."],
  ["text.reason", "Reasoning", "Work through complex multi-step questions and decisions."],
  ["vision.analyze", "Vision analysis", "Understand images alongside natural language prompts."],
  ["image.generate", "Image generation", "Generate images from natural language prompts."],
  ["embeddings.create", "Embeddings", "Create vectors for semantic search and retrieval."],
] as const;

const providers = [
  ["openai", "OpenAI", "OpenAIAdapter"],
  ["gemini", "Google Gemini", "GeminiAdapter"],
  ["anthropic", "Anthropic", "AnthropicAdapter"],
  ["openrouter", "OpenRouter", "OpenRouterAdapter"],
  ["mock", "EKYVA Mock Provider", "MockAdapter"],
] as const;

for (const [id, label, description] of capabilities) {
  await db.insert(capabilitiesTable).values({ id, label, description }).onConflictDoNothing();
}
for (const [key, name, adapter] of providers) {
  await db.insert(providersTable).values({ key, name, adapter }).onConflictDoNothing();
}
console.log("EKYVA seed data is ready.");
process.exit(0);