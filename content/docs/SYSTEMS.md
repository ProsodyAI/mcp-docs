# System

Single source of truth for topology, configuration, and deployment. All runtime config comes from environment variables; no hardcoded URLs or secrets.

## Topology

```
                    ┌─────────────────────────────────────────────────────────┐
                    │  Postgres (managed or self-hosted)                      │
                    │  DATABASE_URL — single connection string                │
                    └─────────────────────────────────────────────────────────┘
                                         ▲
                     Prisma              │              asyncpg
                     (migrations,         │              (read/write)
                      dashboard CRUD)     │
                                         │
    ┌───────────────────────────────────┼───────────────────────────────────┐
    │  Dashboard (website)         │         API (api/)                │
    │  Next.js — auth, UI, /api/*        │         FastAPI — inference,      │
    │  Writes config to DB               │         feedback, sessions,      │
    │  Calls API via PROSODYAI_API_URL   │         admin                     │
    └───────────────────────────────────┘         │                          │
                                                   ▼                          │
                                          Inference backend                    │
                                          PROSODYAI_MODEL_*                    │
    └───────────────────────────────────────────────────────────────────────┘
```

## Configuration contract

Every component reads **only** from environment. No defaults for URLs or secrets in production.

| Variable | Component | Required (prod) | Description |
|----------|-----------|------------------|-------------|
| `DATABASE_URL` | API, Dashboard | Yes | Postgres connection string |
| `PROSODYAI_MODEL_ID` | API | Yes | Model ID (inference backend) |
| `PROSODYAI_MODEL_API_KEY` | API | Yes | API key for model inference |
| `PROSODYAI_ADMIN_API_KEY` | API | Yes (if using /v1/admin) | Admin API key; header `X-Admin-Key` |
| `PROSODYAI_CORS_ORIGINS` | API | Yes | Comma-separated allowed origins (e.g. `https://prosodyai.app`) |
| `PROSODYAI_ORG_BUCKET` | API | No | GCS bucket for per-org audio/transcripts (default `prosodyai-org-data`) |
| `PROSODYAI_API_KEYS` | API | No (use DB) | Optional comma-separated keys; prefer DB-backed keys |
| `PROSODYAI_API_URL` | Dashboard | Yes | Public API base URL (e.g. `https://api.prosodyai.app`) |
| `NEXTAUTH_URL` | Dashboard | Yes | Public dashboard URL (e.g. `https://prosodyai.app`) |
| `NEXTAUTH_SECRET` | Dashboard | Yes | Secret for NextAuth session signing |

Optional: `PROSODYAI_MODEL_DEPLOYMENT` (default `production`), `DIRECT_DATABASE_URL` (Dashboard), `PROSODYAI_DEBUG`, rate limit and Redis vars.

The API builds the inference request URL from `PROSODYAI_MODEL_ID` and `PROSODYAI_MODEL_DEPLOYMENT`. Set `PROSODYAI_MODEL_ID` and `PROSODYAI_MODEL_API_KEY` (and optionally `PROSODYAI_MODEL_DEPLOYMENT`) so the API can call the inference backend. Clients never see or call the backend URL.

## Environments

- **Production**: API runs on **GCP Cloud Run** (deploy from the API repo: `gcloud builds submit . --config=cloudbuild.yaml`); Dashboard can be Vercel, Cloud Run, or another host. Each gets its env from the platform (secrets, env config). Postgres is managed (Neon, RDS, Supabase). Baseten is the inference backend. No localhost; all URLs are public or internal service URLs.
- **Local**: Same env vars, loaded from `.env`. Optionally run Postgres and both apps via `docker-compose`; then `DATABASE_URL` and internal URLs (e.g. `http://api:8080`) are set in `.env` or compose.

## Python API and Next.js coordination

Both use the **same database** (`DATABASE_URL`) and the **same schema** (defined in `website/prisma/schema.prisma`).

| What | Next.js (dashboard) | Python API (api/) |
|------|---------------------|-------------------|
| **DB access** | Prisma (migrations, CRUD) | asyncpg (read/write) |
| **Writes** | KPIs, ApiKeys, Organizations, users, settings | ConversationSession, ConversationTranscript, ConversationAudio, feedback payloads |
| **Reads** | All dashboard tables | KPIs (by API key hash), ApiKey (auth), session/transcript/audio for tenant |
| **Call direction** | Dashboard can call Python API at `PROSODYAI_API_URL` (e.g. demo, health) | API never calls the dashboard |

**Flow:** Dashboard is the config source. Users create KPIs and API keys in the UI (or via admin API). The Python API reads that config at request time (validates key → org_id → load KPIs for that org). No duplicate config; one source of truth in Postgres.

**When the dashboard needs to call the Python API** (e.g. server-side demo or health check), use `PROSODYAI_API_URL` from env. The website can use `getProsodyApiUrl()` or `prosodyApiUrl(path)` from `@/lib/prosody-api` so the base URL is always from env. Example: `GET /api/health/prosody` (Next.js route) calls the Python API at `PROSODYAI_API_URL/health` and returns the result so the dashboard can show Python API status without calling it from the browser.

## Deployment

| Component | Where | How |
|-----------|--------|-----|
| **API** | GCP Cloud Run | This repo: `.github/workflows/deploy.yml` on push to main (builds `api/`, deploys with Baseten env vars). Set `DATABASE_URL`, `PROSODYAI_MODEL_ID`, `PROSODYAI_MODEL_API_KEY`, `PROSODYAI_CORS_ORIGINS`, `PROSODYAI_ADMIN_API_KEY`, `PROSODYAI_ORG_BUCKET`. |
| **Dashboard** | Vercel | Deploy `website/` (submodule ProsodyAI/website). Connect Vercel to this repo or to ProsodyAI/website; not in deploy.yml. Env: `DATABASE_URL`, `PROSODYAI_API_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`. |
| **Model** | Baseten | Manual: `truss train push deploy/config.py`, then `truss push deploy`; set `MODEL_URL` secret. See **[TRAINING.md](TRAINING.md)**. |
| **SDK** | npm | Tag `sdk-v*` → `.github/workflows/publish-sdk.yml` publishes `packages/sdk`. |
| **LangChain** | PyPI | Tag `langchain-v*` → `.github/workflows/publish-langchain.yml` publishes `packages/langchain`. |
| **LiveKit** | — | Code in `packages/livekit`. Release via your own process (no tag workflow in this repo). |

1. **Database**: Provision Postgres; run migrations from Dashboard once: `cd website && DATABASE_URL=<url> npx prisma migrate deploy`.
2. **API**: Deploy via the workflow above or `gcloud builds submit` from api; set Cloud Run env as in the table.
3. **Dashboard**: Deploy `website` to Vercel with env as in the table.
4. **Model**: See **[TRAINING.md](TRAINING.md)**.

## Multi-tenant consumption (how clients use the API)

Each **tenant** is an **Organization** in the database. Tenants are typically voice AI companies (or apps) that integrate ProsodyAI.

1. **Onboarding**  
   A tenant is created in the dashboard (or via admin). They get an **Organization** and can create one or more **API keys** in the dashboard (or via the admin API). Keys are stored in the `ApiKey` table (hashed); each key is tied to an `organizationId`.

2. **Client integration**  
   The tenant’s app uses the ProsodyAI SDK (or any HTTP client) with their API key. Every request to the ProsodyAI API includes the key, e.g. header `X-API-Key: <their_key>`.

3. **Request flow**  
   - API receives the request and reads `X-API-Key`.
   - Key is validated: hash is looked up in `ApiKey` (and optionally env/file for legacy or dev keys). If found, the key is valid and the row’s `organizationId` is the tenant.
   - All operations for that request are **scoped to that organization**: sessions, transcripts, audio metadata, KPI predictions, feedback. No cross-tenant data access.

4. **Per-tenant config**  
   KPIs, alert rules, and other config are stored per `organizationId`. The API loads KPIs for the org that owns the API key and uses them for inference and responses.

So: **one API base URL, one SDK; each tenant uses its own API key.** The key identifies the tenant; the API enforces isolation by organization on every request.

## Security

- CORS: Set explicitly in prod via `PROSODYAI_CORS_ORIGINS`.
- Admin routes: Require `PROSODYAI_ADMIN_API_KEY`; no default.
- API keys: Validated against DB (`ApiKey.keyHash`) first; optional env/file fallback for dev.
- No secrets or public URLs in code; all from env.
