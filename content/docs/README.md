# Docs

- **[STRUCTURE.md](STRUCTURE.md)** — DB, API, dashboard layout
- **[SYSTEMS.md](SYSTEMS.md)** — Topology, env contract, deployment
- **[PAPER.md](PAPER.md)** — Grounded technical paper for the current deployed system
- **env.example** — Copy to repo root as `.env` for local dev (Baseten key: use `.gcp_baseten_key.json` in `deploy/` or env; never commit)
- **schema/** — Reference SQL; source of truth: `website/prisma/schema.prisma`
- **API_CUSTOM_DOMAIN.md** — Map api.prosodyai.app to Cloud Run
- **TRAINING.md** — Training pipeline (Baseten, GCS, deploy checkpoint)
- **BASETEN_TRAINING.md** — Baseten step-by-step (detail)
- **CLOUD_TRAINING.md**, **KPI_*.md** — GCP options, KPI reference
