# EKYVA AI V1

Provider-agnostic AI gateway console for routed generation, Universal Units wallet billing, provider health, and developer API keys.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/ekyva-console run dev` — run the dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test` — routing, wallet, and provider unit tests
- Required env: `DATABASE_URL`, Clerk secrets provisioned by Replit Auth, and optional `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with Clerk-managed browser authentication
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — versioned API source of truth
- `lib/db/src/schema/index.ts` — normalized PostgreSQL schema
- `artifacts/api-server/src/lib/providers.ts` — adapter interface and provider implementations
- `artifacts/api-server/src/lib/routing.ts` — capability filtering and scoring
- `artifacts/api-server/src/lib/wallet.ts` — immutable Universal Units ledger service
- `artifacts/api-server/src/routes/v1.ts` — authenticated v1 gateway and dashboard endpoints
- `artifacts/ekyva-console/src/App.tsx` — Clerk-wrapped responsive console

## Architecture decisions

- Provider SDK calls are isolated behind `ProviderAdapter`; routing never imports provider-specific clients.
- Clerk owns browser authentication; the API does not recreate local password or JWT authentication.
- The local development fallback uses a demo session only when `NODE_ENV` is not production; production requests require a Clerk session.
- Universal Units are represented by append-only ledger events in the wallet service; a mutable balance is only a derived convenience for the MVP.
- Provider status, quality, latency, and cost are model registry data so routing modes can change without provider-specific conditionals.

## Product

The console exposes a public product entry point and protected workspace for wallet balance, usage, request history, models/capabilities, API keys, routing mode, and basic provider health. The API accepts normalized text-generation requests with idempotency and retry/failover semantics.

## User preferences

- Keep the architecture modular for adding providers and future AI capabilities without rewriting the gateway core.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- Generation requires a configured provider credential; unconfigured adapters remain visible as degraded catalog entries but are not called successfully.
- Never expose provider credentials or API key hashes in responses/logs.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
