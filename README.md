# EKYVA AI V1

EKYVA is a provider-agnostic AI gateway console: one API surface for multiple AI capabilities, one Universal Units wallet, and routing that can choose or fail over between configured providers.

## What is included

- Clerk-managed browser authentication with protected console routes
- Versioned JSON API under `/api/v1`
- Provider adapter contract with OpenAI and Anthropic adapters
- Extensible capability registry for text, vision, audio, image, and embeddings
- Economy, balanced, and quality routing modes
- Retry/failover only for retryable provider failures
- Redis-backed generation rate limiting when `REDIS_URL` is configured
- Immutable Universal Units ledger service with CREDIT, DEBIT, REFUND, BONUS, and ADJUSTMENT event types
- API key creation/revocation with one-time secret display
- PostgreSQL schema and Drizzle migration for accounts, providers, models, routing, requests, usage, billing, and audit records
- Responsive operator console for dashboard, models, usage, wallet, keys, settings, and admin health
- Unit tests for routing, wallet accounting, and request fingerprinting

## Run locally with the Replit workspace

The workspace has managed workflows for the API and web console:

```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/ekyva-console run dev
```

The development API allows a demo session when no Clerk browser session is present. Production always requires a Clerk session.

## Run local infrastructure with Docker

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, and the API container. The web console is still served by the workspace workflow so Clerk's Replit-managed development setup is available.

## Environment variables

Copy `.env.example` as a starting point. Replit provisions `DATABASE_URL` and Clerk variables automatically. Configure at least one provider for live generation:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Replit-managed | PostgreSQL connection |
| `CLERK_SECRET_KEY` | Replit-managed | API-side Clerk verification |
| `CLERK_PUBLISHABLE_KEY` | Replit-managed | API-side Clerk middleware |
| `VITE_CLERK_PUBLISHABLE_KEY` | Replit-managed | Console auth provider |
| `OPENAI_API_KEY` | Optional | Enables OpenAI adapter |
| `EKYVA_OPENAI_BASE_URL` | Optional | OpenAI-compatible endpoint override |
| `ANTHROPIC_API_KEY` | Optional | Enables Anthropic adapter |
| `REDIS_URL` | Optional | Redis rate limiting |
| `EKYVA_ADMIN_USER_IDS` | Optional | Comma-separated Clerk user IDs for admin view |

Provider credentials are never returned from the API or written to request logs.

## Verification

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/db run generate
```

## API surface

- `POST /api/v1/ai/generate`
- `GET /api/v1/models`
- `GET /api/v1/capabilities`
- `GET /api/v1/usage`
- `GET /api/v1/requests`
- `GET /api/v1/wallet`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/auth/me`
- `GET /api/v1/api-keys`
- `POST /api/v1/api-keys`
- `DELETE /api/v1/api-keys/{id}`
- `PATCH /api/v1/routing/mode`
- `GET /api/v1/admin/overview`

The OpenAPI source of truth is `lib/api-spec/openapi.yaml`. Run `pnpm --filter @workspace/api-spec run codegen` after changing it.

## Known limitations

- The MVP persists the normalized PostgreSQL schema and migration, while the first dashboard read/write slice uses a process-local domain store to keep the console usable without a full account provisioning workflow. The next step is replacing that store with Drizzle repositories and a Clerk user sync job.
- OpenAI and Anthropic adapters are implemented, but live generation requires the corresponding credential. With no credential, catalog entries are visible as degraded and generation returns an explicit provider-configuration error.
- Payment provider integration, plan checkout, background health polling, and production-grade distributed idempotency storage are intentionally deferred.
