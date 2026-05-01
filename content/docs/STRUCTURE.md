# Structure

One database. One backend API. One dashboard. **Configuration: [SYSTEMS.md](SYSTEMS.md).**

```
┌─────────────────────────────────────────────────────────────────┐
│  Postgres (one DB, one DATABASE_URL)                             │
│  Schema: website/prisma/schema.prisma                       │
└─────────────────────────────────────────────────────────────────┘
     ▲                                    ▲
     │ Prisma                             │ asyncpg
┌────┴────┐                         ┌────┴────┐
│ Dashboard│                         │ API     │
│ website  │  PROSODYAI_API_URL ──►  │ api     │  ──► Baseten
│ website  │                         │ api     │
└──────────┘                         └──────────┘
```

- **DB**: Single `DATABASE_URL`. Schema in **website/prisma**.
- **API** (`api/`): ProsodyAI backend (ProsodyAI/api). Inference (Baseten), feedback, sessions, admin. Env: `DATABASE_URL`, `PROSODYAI_MODEL_ID`, `PROSODYAI_MODEL_API_KEY`, `PROSODYAI_CORS_ORIGINS`, `PROSODYAI_ADMIN_API_KEY`, `PROSODYAI_ORG_BUCKET` (optional).
- **Dashboard** (`website/`): Next.js (ProsodyAI/website). Env: `DATABASE_URL`, `PROSODYAI_API_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.
- **Model** (`prosody_ssm/`): ProsodyAI/model. **Packages** (`packages/langchain`, `packages/sdk`): ProsodyAI/langchain, ProsodyAI/sdk (submodules).

All runtime config from environment. Dashboard and Python API coordinate via the shared DB (dashboard writes KPIs and API keys; API reads them). When the dashboard needs to call the API, it uses `PROSODYAI_API_URL` (see `website/src/lib/prosody-api.ts`). See **[SYSTEMS.md](SYSTEMS.md)** for topology, env contract, and deployment.
