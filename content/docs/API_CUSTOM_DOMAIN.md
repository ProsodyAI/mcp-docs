# Custom domain: api.prosodyai.app

To serve the FastAPI at **https://api.prosodyai.app** and have env vars set on Cloud Run.

## Quick checklist

| Step | What to do |
|------|-------------|
| **DNS** | `api.prosodyai.app` → CNAME → `ghs.googlehosted.com` (already set on Vercel). |
| **Domain mapping** | Run once (same region as your service): `gcloud run domain-mappings create --service=prosody-api --domain=api.prosodyai.app --region=us-central1` |
| **Env vars** | Set via Terraform (tfvars) and `terraform apply`, or via gcloud (see below). |

The API runs on **Cloud Run**. Terraform defines the service in **deploy/infra/cloudrun.tf** and can set env vars; deploy the image from the API repo via Cloud Build.

## Cloud Run settings (recommended)

If you deploy via the workflow or Terraform, these are already set. If you deploy from the console or override, use:

| Setting | Value | Notes |
|--------|--------|------|
| **Memory** | 1 GiB | Python + uvicorn + Baseten client |
| **CPU** | 1 | Enough for request handling; inference is on Baseten |
| **Request timeout** | 300 s | Analysis calls Baseten (~60s); buffer for retries |
| **Concurrency** | 80 | Requests per instance before scale-out |
| **Min instances** | 0 | Scale to zero when idle (or 1 to avoid cold starts) |
| **Max instances** | 10 | Adjust for cost; increase for higher traffic |

**Required env vars** (set in Cloud Run → Edit & deploy → Variables & secrets):

- `DATABASE_URL` — Postgres connection string
- `PROSODYAI_MODEL_ID` — Model ID (inference backend)
- `PROSODYAI_MODEL_API_KEY` — API key for model inference
- `PROSODYAI_CORS_ORIGINS` — e.g. `http://localhost:3000,https://prosodyai.app,https://www.prosodyai.app` (localhost only if you hit prod API from local Next.js)
- `OPENAI_API_KEY` — Whisper transcription on `/v1/stream/realtime` (no `PROSODYAI_` prefix)
- `PROSODYAI_ORG_BUCKET` — e.g. `prosodyai-org-data` for session audio/transcripts
- `PROSODYAI_ADMIN_API_KEY` — (optional) for `/v1/admin/*` routes

After changing env vars locally, sync Cloud Run without a full image rebuild:

`./scripts/cloud-run-update-api-env.sh YOUR_GCP_PROJECT_ID us-central1`

Port is fixed at **8080** in the container (Cloud Run uses it automatically).

### Set env vars via gcloud (if not using Terraform for Cloud Run)

```bash
gcloud run services update prosody-api \
  --region=us-central1 \
  --set-env-vars="DATABASE_URL=postgresql://...",\
"PROSODYAI_MODEL_ID=your-model-id",\
"PROSODYAI_MODEL_API_KEY=your-api-key",\
"PROSODYAI_CORS_ORIGINS=https://prosodyai.app,https://www.prosodyai.app"
```

Or in Console: Cloud Run → prosody-api → Edit & deploy new revision → Variables & secrets → Add the variables.

### Set env vars via Terraform

In **deploy/infra/terraform.tfvars** (copy from `terraform.tfvars.example`), set:

- `api_env_database_url`
- `api_env_direct_database_url`
- `api_env_model_id`
- `api_env_model_api_key`
- `api_env_cors_origins`
- `api_env_admin_api_key` (optional)

Then `terraform apply`. The Cloud Run service will get these as env vars.

## Option A: Cloud Run domain mapping (simplest)

**Region requirement:** Domain mapping supports specific regions only (e.g. `us-central1`, `us-west1`, `us-east1`). If your service is in `us-west2`, use Option B (Load Balancer) or redeploy to `us-central1` (see API repo `cloudbuild.yaml`, `_REGION: us-central1`).

1. **Verify the base domain** (one-time per project). For `api.prosodyai.app` you must verify `prosodyai.app`:

   ```bash
   gcloud domains verify prosodyai.app
   ```

   Complete verification in [Search Console](https://search.google.com/search-console/welcome) (add the TXT or HTML record it gives you at your DNS provider).

2. **Map the service to the custom domain:**

   ```bash
   gcloud beta run domain-mappings create \
     --service=prosody-api \
     --domain=api.prosodyai.app \
     --region=us-central1
   ```

   Use the same `--region` as where your Cloud Run service is deployed.

3. **Add the DNS records** that Cloud Run shows (Console: [Domain mappings](https://console.cloud.google.com/run/domains) → your mapping → ⋮ → DNS Records). Add the CNAME (or A/AAAA) at your registrar for `api` → the value Cloud Run provides.

4. Wait for DNS propagation and for the managed certificate to be issued (a few minutes). Then use `https://api.prosodyai.app`.

**Dashboard:** Set `PROSODYAI_API_URL=https://api.prosodyai.app` in the dashboard env so it calls the API at the custom domain.

## Option B: Global Application Load Balancer

If your service is in a region that doesn’t support domain mapping (e.g. `us-west2`), or you want one load balancer for multiple services:

- **Terraform (recommended):** Use **deploy/infra/lb.tf**. Run `cd deploy/infra && terraform init && terraform apply`. Set an **A record** for `api.prosodyai.app` to the output **api_lb_ip**. Managed SSL and HTTPS are created automatically.
- Manual: [Set up a global external Application Load Balancer with Cloud Run](https://cloud.google.com/load-balancing/docs/https/setup-global-ext-https-serverless).

## Quick check

After mapping:

```bash
curl -s https://api.prosodyai.app/health
```

You should get the API health response.
