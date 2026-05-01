# Training

ProsodySSM training runs on **Baseten** (GPU). Data is read from **GCS**; checkpoints go to Baseten workspace (and optionally GCS). Inference uses the same Baseten stack: deploy a checkpoint as a Truss model.

## Prerequisites

- **Baseten:** [app.baseten.co](https://app.baseten.co), `truss login`, `pip install -U truss`
- **Training access:** If you get 403 "You are not authorized to create training jobs", contact support@baseten.co
- **GCP:** Service account key with Storage Object Viewer on the **datasets** bucket and Object Creator on the **models** bucket. In Baseten → Settings → Secrets, add **`gcp_credentials`** with the full JSON key.

Create a key (Terraform GKE training SA):

```bash
gcloud iam service-accounts keys create .gcp_baseten_key.json \
  --iam-account=$(terraform -chdir=deploy/infra output -raw gke_training_sa) \
  --project=prosodyssm
```

Paste the contents of `.gcp_baseten_key.json` into the Baseten `gcp_credentials` secret.

## Pipeline

### 1. Push and run training

From repo root:

```bash
truss train push deploy/config.py
```

This uploads the repo (per workspace exclude list), starts a job (e.g. 1× H100), runs `deploy/run.sh` → `scripts/training/train.py`. Training downloads datasets from GCS (`scripts/training/data.py`), runs the emotion/VAD loop (`scripts/training/loop.py`), and writes checkpoints to `BT_CHECKPOINT_DIR` (Baseten workspace).

### 2. Monitor

```bash
truss train logs --job-id <job_id> --tail
```

Or use the [Baseten Training UI](https://app.baseten.co/training/).

### 3. Deploy a checkpoint for inference

ProsodySSM saves PyTorch checkpoints (e.g. `best_model_v2.pt`), not HuggingFace layout, so use the **custom Truss** in `deploy/`, not `truss train deploy_checkpoints`.

1. **Get checkpoint URL** (presigned URLs expire; run when you’re about to deploy):

   ```bash
   truss train get_checkpoint_urls --job-id=<job_id>
   ```

   Open the generated JSON and copy the **`url`** for `best_model_v2.pt` (or the checkpoint you want).

2. **Set secret and push inference model**

   ```bash
   truss push deploy --watch
   ```

   In Baseten → your model → **Secrets** → add **`MODEL_URL`** and paste the checkpoint URL. Save (or redeploy) so the container downloads the checkpoint at startup.

3. **Wire the API**  
   Set `PROSODYAI_MODEL_ID` and `PROSODYAI_MODEL_API_KEY` in the API (Cloud Run / env) so the ProsodyAI API calls this deployment.

## Config

| Item | Role |
|------|------|
| `deploy/config.py` | Truss TrainingProject + TrainingJob: image, compute (e.g. H100), runtime (run.sh), checkpointing, cache, `gcp_credentials` secret |
| `deploy/run.sh` | Install torch, causal-conv1d, mamba-ssm, deps; set `GOOGLE_APPLICATION_CREDENTIALS` from secret; run `scripts/training/train.py` |
| `scripts/training/train.py` | Entrypoint: download data from GCS, `run_training()`, optional eval |
| `scripts/training/data.py` | Download manifests and audio from GCS (CREMA-D, RAVDESS, TESS, MSP-Podcast, etc.); real VAD from MSP-Podcast when available |
| `scripts/training/loop.py` | Training loop (emotion, VAD, speaker adversarial); checkpointing; optional GCS upload |
| `.truss_ignore` / workspace exclude | Excludes .git, website, api, docs, data, checkpoints, etc. from upload |

## GCS buckets (Terraform)

- **datasets** (`prosodyssm-prosody-datasets`): Training data (manifests + audio). Training reads from here.
- **models** (`prosodyssm-prosody-models`): Optional checkpoint/artifact uploads from training (e.g. `training_runs/prosody/`, `models/prosody_ssm_v1.pt`).

## Troubleshooting

- **403 on training:** Re-run `truss login`; ensure your Baseten workspace has Training enabled.
- **No training data / GCS errors:** Ensure `gcp_credentials` secret is set and the SA has Storage Object Viewer on the datasets bucket. Check logs for the exact GCS path.
- **causal-conv1d or mamba-ssm build fails:** `deploy/run.sh` uses pre-built wheels where possible; base image is CUDA devel. If you change the image, keep a CUDA devel image so the fallback build works.

## Optional: local / GCP VM training

For local or GCP VM runs (no Baseten): set `GOOGLE_APPLICATION_CREDENTIALS`, then:

```bash
python scripts/training/train.py --data-dir /path/to/data --checkpoint-dir /path/to/checkpoints
```

Data can be prepared by uploading to GCS (see [CLOUD_TRAINING.md](CLOUD_TRAINING.md)) or by using a local data dir that matches the manifest layout expected by `scripts/training/data.py`.
