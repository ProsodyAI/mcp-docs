# ProsodyAI: Comprehensive Project Overview

## What is ProsodyAI?

ProsodyAI is real-time prosodic intelligence infrastructure for voice agents. It tells your agent *how* someone sounds — not just what they say. Audio flows through a frozen WavLM-Large backbone into Mamba selective scan blocks that output continuous Valence-Arousal-Dominance (VAD) predictions and client-defined KPI forecasts (CSAT, escalation risk, churn probability).

The system is deployed as a multi-tenant SaaS: clients create organizations on the dashboard, get API keys, define their KPIs, and integrate via SDK or WebSocket. A single model serves all clients — the KPI-conditioned prediction head adapts to each org's metrics without retraining.

---

## The Model: ProsodySSM

### Architecture

```
Audio Input (16kHz)
    │
    ▼
┌──────────────────────────────┐
│ WavLM-Large (frozen, 315M)   │  1024-dim contextualized features
└────────────┬─────────────────┘
             │
      ┌──────▼──────┐
      │ Linear proj │  1024 → 256
      └──────┬──────┘
             │
    ┌────────▼────────┐
    │ Mamba Blocks (x4)│  Selective scan: input-dependent B(x), C(x), dt(x)
    └────────┬────────┘
             │
      ┌──────┼──────┐
      ▼      ▼      ▼
   Emotion  VAD    KPI
   Head    Head   Head
  (pretrain) │   (conditioned on
             │    client KPI schema)
             ▼
    Continuous prosodic signal
```

- **Backbone**: WavLM-Large (frozen, pretrained on 94K hours of speech). Produces 1024-dim contextualized audio representations.
- **SSM Blocks**: 4 Mamba selective scan layers (S4D diagonal structure). Input-dependent gating learns which frames carry prosodic signal vs noise. Linear complexity in sequence length.
- **Emotion Head**: Pretrained on IEMOCAP, RAVDESS, and other acted emotion corpora. 8 classes: neutral, happy, sad, angry, fearful, disgusted, surprised, contempt. This is a pretraining task — it teaches the backbone prosodic patterns.
- **VAD Head**: Continuous valence, arousal, dominance scores. The primary output for downstream use.
- **KPI Head**: Conditioned on client KPI metadata (type, direction, range). A single head serves all clients — it receives the KPI schema embedding and produces predictions per-KPI. Trained when clients submit actual outcomes.

### Prosodic Features Extracted

| Feature | Description |
|---------|-------------|
| F0 (pitch) | Mean, std, min, max, range, contour |
| Energy | Mean, std, RMS contour |
| Jitter | Pitch perturbation (voice quality) |
| Shimmer | Amplitude perturbation |
| HNR | Harmonics-to-Noise Ratio |
| Speech Rate | Syllables per second |
| MFCCs | 28 mel-frequency cepstral coefficients |
| Spectral | Centroid, flatness, rolloff, ZCR |

### Training

Training runs on **Baseten** (A100 GPU). The pipeline:

1. Emotion pretraining on public datasets (IEMOCAP, RAVDESS) to learn prosodic representations
2. KPI head adaptation when client outcome data is available
3. Checkpoints stored in Baseten artifact storage
4. Deploy checkpoint via Truss: set `MODEL_URL` secret, push `deploy/` Truss

```bash
truss train push deploy/config.py   # Push training job
truss push deploy --watch            # Deploy inference model
```

### Paper

The current technical paper is available in [PAPER.md](PAPER.md):

> **ProsodyAI: Streaming-Capable Prosodic Analysis for Voice Applications**
>
> ProsodyAI converts speech audio into chunk-level emotion, VAD, and prosodic signal estimates. The deployed Baseten model returns emotion probabilities, confidence, valence, arousal, dominance, and model-derived signal scores; KPI support currently lives in the product/API layer through client-defined KPI metadata, outcome feedback collection, and heuristic mappings from prosodic signals. The repository includes hooks for future supervised KPI-head training, but the production system should not be described as an end-to-end trained client-specific KPI forecaster or as having benchmarked QPS without environment-specific load tests.

---

## System Architecture

### Topology

```
                    ┌─────────────────────────────────────────────┐
                    │  Postgres (Prisma Accelerate / Neon)         │
                    │  DATABASE_URL — single connection string     │
                    └─────────────────────────────────────────────┘
                                         ▲
                     Prisma              │              asyncpg
                     (migrations,         │              (read/write)
                      dashboard CRUD)     │
                                         │
    ┌───────────────────────────┐        │        ┌───────────────────────────┐
    │  Dashboard (Next.js)      │        │        │  API (FastAPI)            │
    │  prosodyai.app            │────────┘────────│  api.prosodyai.app        │
    │  Vercel                   │                 │  GCP Cloud Run            │
    │                           │  PROSODYAI_     │                           │
    │  /admin (superadmin)      │  API_URL ──────▶│  /v1/analyze (inference)  │
    │  /organizations/[slug]    │                 │  /v1/stream (WebSocket)   │
    │  /login                   │                 │  /v1/feedback             │
    └───────────────────────────┘                 │  /v1/features             │
                                                  │         │                 │
                                                  │         ▼                 │
                                                  │  Baseten (ProsodySSM)     │
                                                  │  model-31ddmz13           │
                                                  └───────────────────────────┘
                                                           │
                                                  ┌────────▼────────┐
                                                  │  GCS Bucket      │
                                                  │  prosodyai-org-  │
                                                  │  data/{slug}/    │
                                                  │    audio/        │
                                                  │    transcripts/  │
                                                  └─────────────────┘
```

### Components

| Component | Tech | Location | Purpose |
|-----------|------|----------|---------|
| **Dashboard** | Next.js 16, NextAuth, Prisma | `website/` → Vercel | Super-admin panel, client org dashboards, login |
| **API** | FastAPI, asyncpg, httpx | `api/` → GCP Cloud Run | Inference, streaming, feedback, session management |
| **Model** | PyTorch, WavLM, Mamba | `prosody_ssm/` → Baseten | ProsodySSM inference (emotion + VAD) |
| **Database** | PostgreSQL | Prisma Accelerate | Shared state: orgs, users, API keys, KPIs, sessions |
| **Storage** | GCS | `prosodyai-org-data` bucket | Per-org audio + transcript storage |
| **SDK** | TypeScript | `packages/sdk/` → npm | Client integration library |
| **LangChain** | Python | `packages/langchain/` → PyPI | LangChain tool integration |
| **LiveKit** | Python | `packages/livekit/` | Real-time voice call plugin |

---

## Dashboard

### Routes

**Super-admin** (`admin@prosodyai.app`, role `SUPERADMIN`):

| Route | Purpose |
|-------|---------|
| `/admin` | Platform overview: org count, user count, API keys, transcripts |
| `/admin/orgs` | All organizations: plan, members, keys, usage |
| `/admin/orgs/[id]` | Single org: members, keys, "View as org" |
| `/admin/demo` | Live demo call: mic → ProsodySSM + Whisper transcription |
| `/admin/billing` | Subscription overview by plan |
| `/admin/model` | Baseten model status |
| `/admin/infrastructure` | GCP Cloud Run health + console links |

**Client organizations** (`/organizations/[slug]/`):

| Route | Purpose |
|-------|---------|
| `/organizations/[slug]/dashboard` | Org dashboard: API calls, transcripts, keys, KPIs |
| `/organizations/[slug]/calls` | Live calls monitor: active streaming sessions |
| `/organizations/[slug]/calls/[sessionId]` | Single live call: prosody gauges + transcript via observer WebSocket |
| `/organizations/[slug]/calls/history` | Past sessions from GCS with replay |
| `/organizations/[slug]/users` | Manage org members (add/edit/remove) |
| `/organizations/[slug]/api-keys` | Create and revoke API keys |
| `/organizations/[slug]/settings` | Org settings |

### Auth

- NextAuth with JWT strategy
- Providers: Google OAuth, Email, Credentials (dev)
- Roles: `SUPERADMIN`, `ADMIN`, `MEMBER`, `VIEWER`
- Login redirect: SUPERADMIN → `/admin`, org users → `/organizations/[slug]/dashboard`
- Impersonation: superadmin can view any org's dashboard

---

## API Endpoints

### REST

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/v1/analyze/audio` | API key | Analyze uploaded audio file |
| POST | `/v1/analyze/base64` | API key | Analyze base64-encoded audio |
| POST | `/v1/analyze/url` | API key | Analyze audio from URL |
| POST | `/v1/analyze/gcs` | API key | Analyze audio from GCS |
| POST | `/v1/features/extract` | API key | Extract prosodic features only |
| POST | `/v1/feedback/outcome` | API key | Submit actual KPI outcome |
| GET | `/v1/stream/sessions` | — | List active streaming sessions |
| GET | `/v1/stream/health` | — | Streaming health check |
| GET | `/v1/stream/history/{slug}` | — | List stored sessions from GCS |
| GET | `/health` | — | API health check |

### WebSocket

| Endpoint | Purpose |
|----------|---------|
| `WS /v1/stream/realtime` | Real-time prosody streaming (SDK sends PCM, gets directives) |
| `WS /v1/stream/observe/{session_id}` | Observer: dashboard watches live session (read-only) |

### Streaming Protocol

1. Client connects and sends config: `{"type": "config", "sample_rate": 16000, "api_key": "..."}`
2. Server responds: `{"type": "config_ack", "session_id": "...", "kpis_loaded": 3}`
3. Client sends binary PCM audio (5-second chunks, 16kHz mono int16)
4. Server responds with directives:
   ```json
   {
     "type": "directive",
     "prosody": {"valence": 0.3, "arousal": 0.7, "dominance": 0.4},
     "emotion": "neutral",
     "confidence": 0.85,
     "text": "I'm calling about my account...",
     "kpi_predictions": [...],
     "alerts": [...],
     "timestamp_ms": 5000
   }
   ```
5. Client sends end signal: `{"type": "end"}`
6. Server flushes audio + transcript to GCS, closes session

### Agent Modulation

Each `directive` carries an `agent_modulation` block telling the voice agent how
to shape its next reply. When the modulation state changes (entering or leaving
`caller_escalating` / `mirror_calm` / `agent_overheated`), the server also emits a
discrete `agent_steering` event with an LLM-ready `system_prompt` block.

```json
{
  "type": "directive",
  "prosody": {"valence": -0.4, "arousal": 0.78, "dominance": 0.5},
  "agent_modulation": {
    "mode": "caller_escalating",
    "intensity": 0.82,
    "tts": {
      "speed": 0.84,
      "pitch_shift_semitones": -1.6,
      "emotion": "calm",
      "target_intensity": 0.26,
      "pre_pause_ms": 314
    },
    "system_prompt_fragment": "Caller voice indicates rising frustration..."
  }
}
```

```json
{
  "type": "agent_steering",
  "mode": "caller_escalating",
  "previous_mode": "normal",
  "intensity": 0.82,
  "reason": "caller arousal=0.78 valence=-0.4 emotion=angry sustained 2 chunks",
  "tts": { "speed": 0.84, "pitch_shift_semitones": -1.6, "emotion": "calm", "target_intensity": 0.26, "pre_pause_ms": 314 },
  "system_prompt": "[ProsodyAI escalation alert] ...",
  "timestamp_ms": 8000
}
```

Modes:

| Mode | Trigger | What the agent should do |
|------|---------|--------------------------|
| `normal` | Default | Respond naturally |
| `caller_escalating` | Caller arousal high + valence negative for 2+ chunks | Acknowledge feelings, slow down, one-sentence reply, no menus/lists |
| `mirror_calm` | Caller cooled down after escalation | Stay warm and brief, mirror lower energy |
| `agent_overheated` | (Agent voice enrolled) Agent arousal high + valence negative | Soften, slow down, lower pitch, lead with collaborative language |

Agent-vs-caller separation requires a one-time `enroll_agent` message with a
reference WAV, otherwise modulation operates on the conversation as a whole and
`agent_overheated` is disabled.

---

## Multi-Tenant Architecture

Each **Organization** is a tenant. The flow:

1. **Onboarding**: Superadmin creates org in dashboard. Org admin gets login.
2. **API Keys**: Org admin creates API keys in `/organizations/[slug]/api-keys`. Keys are SHA-256 hashed in the `ApiKey` table.
3. **Integration**: Client app uses ProsodyAI SDK with their API key. Every request is scoped to the org that owns the key.
4. **KPIs**: Org defines custom KPIs in the dashboard (scalar, binary, categorical). The API loads KPIs per-org at inference time.
5. **Outcomes**: Client submits actual KPI outcomes via `/v1/feedback/outcome`. This closes the training loop.
6. **Storage**: Audio + transcripts stored in `gs://prosodyai-org-data/{slug}/`. Orgs can bring their own S3/GCS bucket.

---

## Storage

Default: `gs://prosodyai-org-data/{org-slug}/`

```
prosodyai-org-data/
  {org-slug}/
    audio/{session-id}.wav
    transcripts/{session-id}.json
```

- Audio stored as WAV (16kHz mono) after each streaming session ends
- Transcripts stored as JSON with prosody summary, duration, emotion, ASR text
- Orgs can configure custom storage (AWS S3, GCP, Azure) via `storageBucket` field

---

## Deployment

| Component | Platform | Trigger |
|-----------|----------|---------|
| API | GCP Cloud Run | GitHub Actions on push to `master` (`.github/workflows/deploy.yml`) |
| Dashboard | Vercel | Auto-deploy on push to `main` |
| Model | Baseten | `truss push deploy --watch` |
| Database | Prisma Accelerate | `npx prisma migrate deploy` |

### API Deploy Pipeline

Push to `master` → GitHub Actions → build Docker image → push to Artifact Registry → `gcloud run deploy` with env vars (`DATABASE_URL`, `PROSODYAI_MODEL_ID`, `PROSODYAI_MODEL_API_KEY`, `PROSODYAI_CORS_ORIGINS`, `PROSODYAI_ORG_BUCKET`).

### DNS

| Domain | Points to |
|--------|-----------|
| `prosodyai.app` | Vercel (dashboard) |
| `www.prosodyai.app` | Vercel (dashboard) |
| `api.prosodyai.app` | GCP Cloud Run (API) |

---

## SDKs and Integrations

### TypeScript SDK (`@prosodyai/sdk`)

```typescript
import { ProsodyAI } from '@prosodyai/sdk';

const client = new ProsodyAI({ apiKey: 'psk_...' });

// Analyze audio
const result = await client.analyze.fromFile(audioBuffer);
console.log(result.prosody.valence, result.emotion);

// Real-time streaming
const stream = client.createRealtimeStream({ sampleRate: 16000 });
stream.on('directive', (d) => {
  console.log(d.prosody, d.kpi_predictions);
});
stream.sendAudio(pcmBuffer);
```

### LangChain Integration (`prosodyai-langchain`)

```python
from prosodyai_langchain import ProsodyTool

tool = ProsodyTool(api_key="psk_...")
result = tool.invoke({"audio_path": "call.wav"})
```

### LiveKit Plugin (`livekit-plugins-prosodyai`)

```python
from livekit_plugins_prosodyai import ProsodyAnalyzer

analyzer = ProsodyAnalyzer(model_path="checkpoints/best_model.pt")
async for event in analyzer.analyze_track(audio_track):
    if event.valence < -0.5 and event.arousal > 0.7:
        await session.say("I can hear this is frustrating...")
```

---

## Supported Verticals

| Vertical | Use Case | Key Metrics |
|----------|----------|-------------|
| Contact Center | Customer service QA | CSAT prediction, escalation risk, first-call resolution |
| Healthcare | Mental health monitoring | Depression/anxiety markers, clinical attention |
| Sales | Deal coaching | Buying intent, deal probability, objection count |
| Education | Learner engagement | Comprehension, pacing recommendations |
| HR/Interviews | Candidate assessment | Authenticity, confidence score |
| Media | Audience engagement | Entertainment value, emotional intensity |
| Finance | Client suitability | Trust level, comprehension |
| Legal | Witness credibility | Consistency, evasion detection |

---

## Monorepo Structure

```
prosodyai/
├── api/                     FastAPI REST API (submodule ProsodyAI/api)
│   ├── routes/              analysis, streaming, feedback, features, health, admin, sessions
│   ├── streaming/           ProsodicPipeline, session store
│   ├── storage.py           GCS org storage helpers
│   ├── client.py            ProsodyClient for model inference
│   ├── kpis.py              KPI loader from shared DB
│   ├── kpi_predictor.py     KPI prediction from prosody signals
│   └── config.py            Pydantic settings from env
│
├── website/                 Next.js dashboard (submodule ProsodyAI/website)
│   ├── src/app/admin/       Super-admin pages
│   ├── src/app/organizations/[orgId]/  Client org pages
│   ├── src/app/api/         API routes (auth, api-keys, admin, org proxies)
│   ├── src/lib/             auth.ts, prisma.ts
│   └── prisma/schema.prisma Database schema
│
├── prosody_ssm/             Core model library (submodule ProsodyAI/model)
│   ├── model.py             ProsodySSM (WavLM + Mamba + heads)
│   ├── features.py          Feature extraction
│   └── conversation_model.py ConversationPredictor
│
├── packages/
│   ├── sdk/                 @prosodyai/sdk TypeScript (submodule ProsodyAI/sdk)
│   ├── langchain/           prosodyai-langchain (submodule ProsodyAI/langchain)
│   └── livekit/             livekit-plugins-prosodyai (in-repo)
│
├── deploy/                  Baseten training + Truss inference config
│   ├── config.py            Training: A100, pytorch, checkpointing
│   ├── config.yaml          Inference: L4 GPU, model serving
│   ├── infra/               Terraform: Cloud Run, VPC, Load Balancer
│   └── run.sh               Runs scripts/training/train.py
│
├── docs/                    SYSTEMS.md, STRUCTURE.md, env.example, paper
├── scripts/                 Training scripts, data download
├── .github/workflows/       deploy.yml (API CI/CD)
└── docker-compose.yaml      Local dev
```

---

## Configuration

All runtime config from environment variables. No hardcoded URLs or secrets.

| Variable | Component | Description |
|----------|-----------|-------------|
| `DATABASE_URL` | API, Dashboard | Postgres connection string |
| `PROSODYAI_MODEL_ID` | API | Baseten model ID (`31ddmz13`) |
| `PROSODYAI_MODEL_API_KEY` | API | Baseten API key |
| `PROSODYAI_CORS_ORIGINS` | API | Allowed origins |
| `PROSODYAI_ORG_BUCKET` | API | GCS bucket for org data (`prosodyai-org-data`) |
| `PROSODYAI_API_URL` | Dashboard | API base URL |
| `NEXTAUTH_URL` | Dashboard | Dashboard public URL |
| `NEXTAUTH_SECRET` | Dashboard | Session signing secret |
| `OPENAI_API_KEY` | API | Whisper transcription |
| `BASETEN_API_KEY` | Dashboard | Model management API |

---

## License

MIT
