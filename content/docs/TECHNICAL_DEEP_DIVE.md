# ProsodyAI — Technical Deep Dive

## Table of Contents

1. [System Overview](#1-system-overview)
2. [ProsodySSM Model Architecture](#2-prosodyssm-model-architecture)
3. [Training Pipeline](#3-training-pipeline)
4. [Inference & Deployment (Baseten)](#4-inference--deployment-baseten)
5. [API Layer (FastAPI on Cloud Run)](#5-api-layer-fastapi-on-cloud-run)
6. [Real-Time Streaming Pipeline](#6-real-time-streaming-pipeline)
7. [KPI Prediction System](#7-kpi-prediction-system)
8. [SDK (TypeScript)](#8-sdk-typescript)
9. [Website & Dashboard (Next.js)](#9-website--dashboard-nextjs)
10. [Infrastructure & CI/CD](#10-infrastructure--cicd)
11. [Database Schema](#11-database-schema)
12. [End-to-End Data Flow](#12-end-to-end-data-flow)

---

## 1. System Overview

ProsodyAI is a real-time prosodic analysis platform that extracts emotion, affect, and interpretable signals from speech audio. It serves multi-tenant SaaS clients through a unified API, with client-defined KPI predictions layered on top of base emotion/VAD representations.

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Client Applications                              │
│   TypeScript SDK  ·  WebSocket  ·  REST API  ·  Dashboard               │
└──────────────────┬───────────────────────────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────────────────────────┐
│              FastAPI Service (Cloud Run)                                  │
│  ┌────────────┐ ┌────────────┐ ┌─────────────┐ ┌──────────────────────┐ │
│  │  Analysis   │ │  Streaming │ │  Feedback   │ │  KPI Predictor       │ │
│  │  Routes     │ │  Pipeline  │ │  Routes     │ │  (heuristic/neural)  │ │
│  └──────┬─────┘ └─────┬──────┘ └──────┬──────┘ └──────────────────────┘ │
│         │             │               │                                  │
│    ┌────▼─────────────▼───┐    ┌──────▼──────────┐                      │
│    │  Baseten Client      │    │  PostgreSQL      │                      │
│    │  (ProsodySSM model)  │    │  (shared w/ web) │                      │
│    └──────────┬───────────┘    └──────────────────┘                      │
└───────────────┼──────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────────────┐
│              Baseten (GPU Inference)                                      │
│  ┌──────────────────────────────────────────────────┐                    │
│  │  ProsodySSM: WavLM → Mamba SSM → Heads           │                    │
│  │  L4 GPU · 16Gi RAM · config.yaml (Truss)         │                    │
│  └──────────────────────────────────────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Ownership Boundaries

| Layer | Owns | Reads |
|-------|------|-------|
| **Next.js Dashboard** | KPIs, API keys, orgs, users, taxonomies, integrations | Session results from GCS |
| **Python API** | Inference orchestration, streaming, feedback/outcomes | KPI definitions, API keys from shared DB |
| **Baseten Model** | Raw model inference (emotion + VAD + signals) | Model checkpoint from GCS |

---

## 2. ProsodySSM Model Architecture

### Overview

ProsodySSM is a state-space model for speech prosody analysis. It uses a frozen WavLM-Large backbone for acoustic feature extraction, followed by Mamba SSM blocks for temporal modeling, with multiple task-specific heads.

### Input

- **Waveform**: `(B, T_samples)` — raw 16 kHz mono audio, variable length
- **Optional prosody features**: `(B, T_frames, 28)` — 28-dim MFCC features for dual-stream fusion

### Architecture Diagram

```
Waveform (B, T)
      │
      ▼
┌─────────────────────────────┐
│  WavLM-Large (frozen)       │
│  microsoft/wavlm-large      │
│  Hidden: 1024-dim, 24 layers│
│  Optional: weighted layer   │
│  combination (softmax)      │
│  Proj: Linear(1024, d_model)│
│  + LayerNorm                │
└──────────┬──────────────────┘
           │ (B, T', d_model)
           │
    ┌──────▼──────────────────┐     ┌────────────────────┐
    │  [Optional] Dual-Stream │◄────│  Prosody MFCC      │
    │  Gated Fusion           │     │  Linear(28, d_model)│
    │  gate = σ(W·[x, p])    │     │  + LayerNorm + GELU │
    │  x = gate·x + (1-g)·p  │     └────────────────────┘
    └──────────┬──────────────┘
               │
    ┌──────────▼──────────────┐
    │  SpecAugment (training) │
    │  Time mask: [1, 20]     │
    │  Freq mask: [1, 64]     │
    │  Prob: 0.5              │
    └──────────┬──────────────┘
               │
    ┌──────────▼──────────────┐
    │  N × MambaBlock         │   N=6 in production
    │  ┌────────────────────┐ │
    │  │ LayerNorm           │ │
    │  │ Mamba(d=512,        │ │   Selective SSM
    │  │   d_state=128,      │ │   d_conv=4, expand=2
    │  │   d_conv=4,         │ │
    │  │   expand=2)         │ │
    │  │ Dropout + Residual  │ │
    │  └────────────────────┘ │
    └──────────┬──────────────┘
               │ (B, T', d_model)  "sequence_repr"
               │
        mean pool(dim=1)
               │
               ▼ (B, d_model)  "repr"
    ┌──────────┴──────────────────────────────────────┐
    │          │           │           │               │
    ▼          ▼           ▼           ▼               ▼
 Emotion    VAD Head    Signal     Speaker          KPI Head
 Classifier             Heads      Head (GRL)       (conditional)
```

### Production Hyperparameters

| Parameter | Value |
|-----------|-------|
| `d_model` | 512 |
| `n_layers` | 6 |
| `d_state` | 128 |
| `d_conv` | 4 |
| `expand` | 2 |
| `n_emotions` | 7 (neutral, happy, sad, angry, fearful, disgusted, surprised) |
| `use_wavlm` | True |
| `use_weighted_wavlm_layers` | True |
| `use_dual_stream_fusion` | True |
| `n_speakers` | 94 (dataset actors, adversarial) |
| `specaugment_prob` | 0.5 |
| Total params | ~328M (13M trainable, WavLM frozen) |

### Head Architectures

**Emotion Classifier** — `(B, d_model) → (B, n_emotions)`
```
LayerNorm → Linear(512, 512) → GELU → Dropout → Linear(512, 7)
```

**VAD Head** — `(B, d_model) → (B, 3)` where outputs ∈ [-1, 1]
```
LayerNorm → Linear(512, 256) → GELU → Dropout → Linear(256, 3) → Tanh
```
Output: [valence, arousal, dominance]. API rescales arousal/dominance to [0,1] via `(x+1)/2`.

**Signal Heads** — `(B, d_model) → (B, 8)` where each ∈ [0, 1]
```
LayerNorm → Linear(512, 128) → GELU → Dropout → Linear(128, 8) → Sigmoid
```
Signals: engagement, stress, certainty, rapport, empathy, tempo, intensity, expressiveness.

**Speaker Adversarial Head** — `(B, d_model) → (B, n_speakers)` with gradient reversal
```
GRL(repr, α=0.1) → LayerNorm → Linear(512, 256) → GELU → Dropout → Linear(256, 94)
```
**Gradient Reversal Layer (GRL):**
- Forward: \( y = x \)
- Backward: \( \frac{\partial \mathcal{L}}{\partial x} = -\alpha \cdot \frac{\partial \mathcal{L}}{\partial y} \)

This pushes the backbone toward speaker-invariant representations while the head tries to classify speaker identity.

**KPI Head** (conditional, not yet trained) — `(B, d_model + 3·d_kpi_embed) → scalar + categorical`
```
Conditioning:
  type_emb  = Embedding(3, 32)[kpi_type]      # SCALAR/BINARY/CATEGORICAL
  dir_emb   = Embedding(2, 32)[kpi_direction]  # HIGHER/LOWER_IS_BETTER
  range_emb = Linear(2, 32)([range_min, range_max])
  cond = concat(type_emb, dir_emb, range_emb)  # (B, 96)

Trunk:
  x = concat(repr, cond)  # (B, 608)
  LayerNorm → Linear(608, 512) → GELU → Dropout

Outputs:
  kpi_value = Linear(512, 1)        # continuous prediction
  kpi_category_logits = Linear(512, 16)  # categorical prediction
```

### S4D Fallback (when `mamba_ssm` unavailable)

Diagonal complex state-space model with learned discretization:

\[
\Delta = e^{\log\_dt}, \quad
\bar{A} = e^{(-A_r + i A_i) \cdot \Delta}, \quad
\bar{B} = \Delta \odot B
\]
\[
h_t = \bar{A} \odot h_{t-1} + \bar{B} \odot x_t, \quad
y_t = \text{Re}\left(\sum_j C_j h_{t,j}\right) + D \odot x_t
\]

Where \(A_r = 0.5\), \(A_i[j] = j\pi\) (HiPPO-inspired initialization).

### Weighted WavLM Layer Combination

When enabled, a learnable softmax-weighted combination across all WavLM layers:

\[
\mathbf{w} = \text{softmax}(\theta), \quad
\mathbf{x} = \sum_{k=0}^{L} w_k \cdot \mathbf{h}^{(k)}
\]

Where \(\theta \in \mathbb{R}^{L+1}\) is learnable (25 layers: embedding + 24 transformer layers), and \(\mathbf{h}^{(k)}\) are per-layer hidden states from WavLM.

### Forward Output Dictionary

| Key | Shape | Condition |
|-----|-------|-----------|
| `emotion_logits` | `(B, n_emotions)` | Always |
| `vad` | `(B, 3)` | Always |
| `repr` | `(B, d_model)` | Always |
| `sequence_repr` | `(B, T, d_model)` | Always |
| `signals` | dict of 8 keys → `(B,)` | Always |
| `speaker_logits` | `(B, n_speakers)` | `n_speakers > 0` |
| `kpi_value` | `(B,)` | `kpi_type` provided |
| `kpi_category_logits` | `(B, max_categories)` | `kpi_type` provided |

---

## 3. Training Pipeline

### Dataset Composition

| Dataset | Samples | Source | Emotions |
|---------|---------|--------|----------|
| CREMA-D | ~7,442 | GCS `datasets/crema-d` | angry, disgusted, fearful, happy, neutral, sad |
| RAVDESS | ~1,440 | GCS `datasets/audio/ravdess` | calm→neutral, happy, sad, angry, fearful, disgusted, surprised |
| TESS | ~2,800 | GCS `datasets/tess` or Kaggle | angry, disgusted, fearful, happy, neutral, sad, surprised |
| Orpheus | variable | Optional volume mount | Various |
| MSP-Podcast | variable | GCS `datasets/msp-podcast` | Conversational, with VAD labels |

**Total**: ~13,000 samples. **Split**: speaker-disjoint — ~10% of unique actors held out for validation.

### Data Pipeline

```
Raw Audio (variable SR) → Resample to 16 kHz → Pad/truncate to 5s (80,000 samples)
                                                        │
                                                        ├── Waveform tensor (1, 80000)
                                                        │
                                                        └── MFCC features (T, 28)
                                                             n_mfcc=28, n_fft=1024, hop=320
```

**Augmentation** (training only):
- 30% chance: Gaussian noise (σ ∈ [0.001, 0.008])
- 30% chance: Gain scaling (0.8× to 1.2×)

### Loss Functions

**Multi-task loss with GradNorm dynamic balancing:**

\[
\mathcal{L} = \sum_{i=1}^{K} w_i \cdot \mathcal{L}_i
\]

Where \(K \in \{2, 3\}\) (emotion + VAD, optionally + speaker).

| Task | Loss | Details |
|------|------|---------|
| Emotion | `CrossEntropyLoss` | Inverse-frequency class weights, label smoothing = 0.1 |
| VAD | `MSELoss` | When VAD targets exist; on 3-dim [valence, arousal, dominance] |
| Speaker | `CrossEntropyLoss` | Adversarial (via GRL); dataset actor IDs |

### GradNorm Balancer

Dynamic multi-task weight balancing with \(\alpha = 1.5\):

\[
\mathbf{d} = \text{stack}(\mathcal{L}_1, \ldots, \mathcal{L}_K).\text{detach}().\text{clamp}(\epsilon)
\]
\[
\text{rates} = \left(\frac{\mathbf{d}}{\mathbf{d}_0}\right)^\alpha \quad (\mathbf{d}_0 = \text{initial losses})
\]
\[
\text{base} = \text{softmax}(\boldsymbol{\phi}) \quad (\boldsymbol{\phi} \text{ learnable})
\]
\[
\mathbf{w} = \frac{\text{base} \cdot \text{rates}}{\sum (\text{base} \cdot \text{rates})} \cdot K
\]

### Feature-Level Mixup (50% chance per batch when VAD exists)

\[
\lambda \sim \text{Beta}(0.4, 0.4), \quad
j = \text{randperm}(B)
\]
\[
\tilde{\mathbf{s}} = \lambda \mathbf{s} + (1-\lambda) \mathbf{s}[j] \quad \text{(on sequence\_repr)}
\]
\[
\mathcal{L}_\text{emo} = \lambda \cdot \text{CE}(\hat{y}, y) + (1-\lambda) \cdot \text{CE}(\hat{y}, y[j])
\]
\[
\mathcal{L}_\text{VAD} = \text{MSE}(\hat{v}, \lambda v + (1-\lambda) v[j])
\]

### Optimizer & Schedule

- **AdamW**: lr=1e-4, weight_decay=0.01
- **CosineAnnealingLR**: T_max = epochs × steps_per_epoch (per-step)
- **Gradient clipping**: max_norm=1.0
- **AMP**: autocast + GradScaler on CUDA

### Checkpointing

- `best_model_v2.pt` — best validation weighted accuracy
- `prosody_resume_v2.pt` — latest epoch
- `rank-0/checkpoint-{epoch}/` — HuggingFace-style layout (config.json + pytorch_model.bin); last 3 kept
- Atomic saves via temp file + rename to prevent corruption
- Optional GCS upload every 5 epochs

### Health Checks (automated)

| Check | Condition |
|-------|-----------|
| `loss_not_nan` | Train loss is finite |
| `loss_not_diverged` | Last loss ≤ 10× first loss |
| `loss_decreased` | Final < initial |
| `val_accuracy_above_chance` | Best val WA ≥ 0.2 |
| `no_severe_overfitting` | train_acc − val_WA ≤ 0.3 |
| `val_not_plateaued` | Improvement in last 10 epochs vs prior window |
| `no_class_collapse` | Enough classes with recall > 0.1 |

---

## 4. Inference & Deployment (Baseten)

### Truss Configuration

- **Base image**: `pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel`
- **GPU**: NVIDIA L4 (24 GiB VRAM)
- **Resources**: 4 CPU, 16Gi RAM
- **Health check delay**: 900s (15 min for model download + WavLM load)

### Model Loading Priority

1. `MODEL_URL` secret (gs:// or HTTPS) → download to `/tmp/prosody_model.pt`
2. `MODEL_PATH` environment variable
3. `TRUSS_DATA_DIR` with `config.json` / `prosody_model.pt` / `best_model_v2.pt`
4. Baseten training checkpoint dir `/tmp/training_checkpoints/.../rank-0/checkpoint-*`

### Predict Flow

```
audio_base64 → decode → temp WAV → soundfile.read → resample to 16kHz if needed
  → torch tensor (1, T) → model.forward(waveform=tensor)
  → softmax(emotion_logits) → argmax → confidence thresholding
  → VAD rescaling (tanh [-1,1] → arousal/dominance to [0,1])
  → return {emotion, confidence, emotion_probabilities, valence, arousal, dominance, signals}
```

**Post-processing**: Low-confidence emotions (< 0.45) collapse to neutral. Rare emotions (fearful, disgusted, contempt) require confidence ≥ 0.55.

---

## 5. API Layer (FastAPI on Cloud Run)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/v1/analyze/audio` | File upload analysis |
| `POST` | `/v1/analyze/base64` | Base64 audio analysis |
| `POST` | `/v1/analyze/url` | URL-referenced audio |
| `POST` | `/v1/analyze/gcs` | GCS path audio |
| `POST` | `/v1/features/prosody` | Prosodic feature extraction |
| `POST` | `/v1/features/phonetic` | Phonetic feature extraction |
| `WS` | `/v1/stream/realtime` | Real-time streaming |
| `WS` | `/v1/stream/observe/{session_id}` | Observer WebSocket |
| `GET` | `/v1/stream/history/{org_slug}` | Session history list |
| `GET` | `/v1/stream/history/{org_slug}/{session_id}` | Session transcript |
| `POST` | `/v1/feedback/correction` | Prediction corrections |
| `POST` | `/v1/feedback/session_outcome` | KPI outcome submission |
| `POST` | `/v1/sessions` | Create conversation session |
| `POST` | `/v1/sessions/{id}/transcript` | Submit transcript text |
| `POST` | `/v1/sessions/{id}/audio` | Submit audio metadata |
| `POST` | `/v1/admin/tenants/{orgId}/api-keys` | Create API key |
| `GET` | `/v1/admin/tenants/{orgId}/api-keys` | List API keys |

### Auth

- **API key**: `X-API-Key` header → SHA-256 hash → lookup in `ApiKey` table
- **Admin**: `X-Admin-Key` header or `Authorization: Bearer` token
- **Dev fallback**: `demo-api-key`, `test-api-key` in debug mode

### Rate Limiting

- In-memory sliding window (24h)
- Per-plan daily caps: free=100, starter=5,000, pro=50,000, enterprise=unlimited
- Streaming blocked for free/starter plans
- Response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Analysis Response Schema

```json
{
  "prediction_id": "uuid",
  "session_id": "uuid",
  "text": "transcribed text",
  "prosody": {
    "valence": 0.45,
    "arousal": 0.62,
    "dominance": 0.55,
    "markers": { "pitch_trend": "rising", "intensity": "moderate", "tempo": "normal" }
  },
  "signals": {
    "engagement": 0.72,
    "stress": 0.31,
    "certainty": 0.65,
    "rapport": 0.58,
    "empathy": 0.44,
    "tempo": 0.51,
    "intensity": 0.48,
    "expressiveness": 0.63
  },
  "emotion": { "primary": "happy", "confidence": 0.82, "probabilities": {...} },
  "duration": 2.0,
  "word_count": 8,
  "kpi_predictions": [...],
  "alerts": [...]
}
```

---

## 6. Real-Time Streaming Pipeline

### Flow

```
Client (mic) → PCM 16kHz Int16 → WebSocket binary frames
                                        │
                    ┌───────────────────►│ Buffer accumulation
                    │                    │ (64,000 bytes = 2 seconds)
                    │                    │
                    │              ┌─────▼─────┐
                    │              │ RMS Gate   │ threshold=200
                    │              │ (silence?) │
                    │              └──┬────┬───┘
                    │            skip │    │ speech
                    │                 │    ▼
                    │              ┌──┴────────────────────┐
                    │              │  Parallel Execution    │
                    │              │                        │
                    │              │  ┌──────────────────┐  │
                    │              │  │ Baseten Model     │  │ 10s timeout
                    │              │  │ → emotion + VAD   │  │
                    │              │  │   + signals       │  │
                    │              │  └──────────────────┘  │
                    │              │                        │
                    │              │  ┌──────────────────┐  │
                    │              │  │ OpenAI Whisper    │  │ 8s timeout
                    │              │  │ → transcription   │  │
                    │              │  │   + context prompt│  │
                    │              │  └──────────────────┘  │
                    │              └──────────┬─────────────┘
                    │                         │
                    │              ┌──────────▼──────────┐
                    │              │ Speaker Detection    │
                    │              │ (resemblyzer)        │
                    │              │ agent vs caller      │
                    │              │ or speaker_0/1/2/3   │
                    │              └──────────┬──────────┘
                    │                         │
                    │              ┌──────────▼──────────┐
                    │              │ EMA Smoothing        │
                    │              │ α=0.6 on VAD,        │
                    │              │ emotion probs,       │
                    │              │ signals              │
                    │              └──────────┬──────────┘
                    │                         │
                    │              ┌──────────▼──────────┐
                    │              │ Segment Accumulation │
                    │              │ → TranscriptSegment  │
                    │              │ (text + speaker +    │
                    │              │  emotion + prosody)  │
                    │              └──────────┬──────────┘
                    │                         │
                    │                    AgentDirective
                    │                         │
                    │              ┌──────────▼──────────┐
                    │              │ WebSocket JSON       │──► Client
                    │              │ type: "directive"    │
                    └──────────────│ + KPI predictions    │
                                  │ + alerts              │
                                  └─────────────────────┘
```

### Temporal Smoothing (EMA)

\[
\hat{x}_t = \alpha \cdot x_t + (1 - \alpha) \cdot \hat{x}_{t-1}, \quad \alpha = 0.6
\]

Applied to: valence, arousal, dominance, confidence, each signal, and emotion probabilities (renormalized after smoothing).

### Speaker Diarization

- **Resemblyzer** voice encoder for 256-dim speaker embeddings
- If agent voice enrolled: cosine similarity vs threshold 0.60 → "agent" or "caller"
- Otherwise: online centroid clustering (up to 4 speakers), EMA centroid update (α=0.3), L2-normalized

### Aligned Transcript

On each directive, a `TranscriptSegment` is accumulated:

```python
TranscriptSegment(
    start_ms=0,      end_ms=2000,
    text="hello",    speaker_id="caller",
    emotion="happy", confidence=0.82,
    valence=0.45,    arousal=0.62,    dominance=0.55,
    signals={...}
)
```

Consecutive same-speaker segments merge into `TranscriptTurn` objects on session end:

```python
TranscriptTurn(
    start_ms=0,        end_ms=6000,
    speaker_id="caller",
    text="hello how are you doing today",
    segments=[seg1, seg2, seg3],
    dominant_emotion="happy",
    avg_confidence=0.79,
    avg_valence=0.42,  avg_arousal=0.58,  avg_dominance=0.53,
)
```

### Session End Payload

When a client sends `{type: "end"}`, the server responds with the full aligned transcript:

```json
{
  "type": "session_end",
  "session_id": "uuid",
  "frames_processed": 15,
  "transcript": {
    "session_id": "uuid",
    "duration_seconds": 30.0,
    "turns": [ ... ],
    "segments": [ ... ]
  }
}
```

This is also persisted to GCS as `{org_slug}/transcripts/{session_id}.json`.

---

## 7. KPI Prediction System

### Architecture: Dashboard-Defined, API-Consumed

KPIs are defined by clients in the Next.js dashboard (stored in PostgreSQL). The Python API reads them at inference time and predicts outcomes.

### KPI Types

| Type | Example | Prediction Output |
|------|---------|-------------------|
| SCALAR | CSAT score (1-5) | Continuous value within `[range_min, range_max]` |
| BINARY | Will escalate? | Probability [0, 1] |
| CATEGORICAL | Disposition (resolved/transferred/escalated) | Category index + confidence |

### Heuristic Predictor (current)

The current `KPIPredictor` uses hand-crafted psycholinguistic mappings from prosodic signals:

- **Valence** → base outcome quality (positive valence → better outcomes)
- **Arousal** → modulation factor (high arousal + negative valence → worse)
- **Dominance** → nudge factor
- **Voice quality** (jitter, shimmer) → stress indicators
- **Speech rate** → engagement/urgency signals
- **Trajectory**: 3+ historical samples enable trend detection (improving/declining/stable)

### Neural KPI Head (architecture exists, not yet trained)

The `KPIHead` in ProsodySSM accepts conditioning vectors (KPI type, direction, range) and produces per-KPI predictions. Training requires client-submitted `KpiOutcome` ground truth to close the learning loop.

---

## 8. SDK (TypeScript)

### Installation

```bash
npm install @prosodyai/sdk
```

### Core Classes

**`ProsodyClient`** — HTTP analysis:
```typescript
import { ProsodyClient } from '@prosodyai/sdk';

const client = new ProsodyClient({ apiKey: 'your-key', baseUrl: 'https://api.prosodyai.app' });
const result = await client.analyzeBase64(audioBase64, { language: 'en' });
// result: AnalysisResult { emotion, valence, arousal, dominance, signals, text, ... }
```

**`ProsodyRealtimeStream`** — WebSocket streaming:
```typescript
import { ProsodyRealtimeStream } from '@prosodyai/sdk';

const stream = new ProsodyRealtimeStream(client, {
  onResult: (result) => {
    console.log(result.emotion.primary, result.speaker_id, result.text);
  },
  onTranscript: (transcript) => {
    // Full aligned transcript on session end
    for (const turn of transcript.turns) {
      console.log(`[${turn.speaker_id}] ${turn.text} — ${turn.dominant_emotion}`);
    }
  },
});

await stream.connect();
stream.send(pcmInt16Array);  // sends binary PCM frames
await stream.end();          // waits for session_end with transcript
```

**`ProsodyStream`** — HTTP chunked analysis (non-WebSocket):
```typescript
import { ProsodyStream } from '@prosodyai/sdk';

const stream = new ProsodyStream(client, {
  chunkDuration: 3,  // seconds
  onResult: (result) => { ... },
});

stream.write(float32Samples);
await stream.end();
```

### Key Types

```typescript
interface AnalysisResult {
  prediction_id: string;
  session_id?: string;
  text: string;
  emotion: EmotionResult;         // { primary, confidence, probabilities }
  valence: number;                // [-1, 1]
  arousal: number;                // [0, 1]
  dominance: number;              // [0, 1]
  signals?: ProsodySignals;       // 8 interpretable signals [0, 1]
  speaker_id?: string;            // "agent" | "caller" | "speaker_0" | ...
  kpi_predictions?: KPIPredictionResult[];
  alerts?: KPIAlertResult[];
}

interface SessionTranscript {
  session_id: string;
  duration_seconds: number;
  turns: TranscriptTurn[];
  segments?: TranscriptSegment[];
}

interface TranscriptTurn {
  start_ms: number;
  end_ms: number;
  speaker_id: string;
  text: string;
  segments: TranscriptSegment[];
  dominant_emotion: string;
  avg_confidence: number;
  avg_valence: number;
  avg_arousal: number;
  avg_dominance: number;
}
```

---

## 9. Website & Dashboard (Next.js)

### Technology

- **Framework**: Next.js 14+ (App Router)
- **Auth**: NextAuth.js (Google OAuth, email)
- **ORM**: Prisma (PostgreSQL)
- **Hosting**: Vercel
- **Styling**: Tailwind CSS

### Key Pages

| Route | Description |
|-------|-------------|
| `/` | Marketing landing with live prediction demo widget |
| `/login` | Auth + "Book a Demo" modal |
| `/admin/demo` | **Live Demo Call** — mic capture → WebSocket → real-time prosody analysis |
| `/organizations/[orgId]/dashboard` | Org analytics (usage, transcripts, KPIs, API keys) |
| `/organizations/[orgId]/calls` | Active sessions + call history |
| `/organizations/[orgId]/calls/[sessionId]` | Live call observer via `/v1/stream/observe/{sessionId}` |
| `/organizations/[orgId]/api-keys` | API key management |
| `/organizations/[orgId]/settings` | Organization settings |

### Demo Call Architecture

The demo call page captures microphone audio, resamples to 16 kHz, and streams 2-second PCM chunks over WebSocket:

1. `getUserMedia` → `AudioContext` → `ScriptProcessor` (resample to 16 kHz)
2. Buffer Int16 samples → send 2s binary chunks to `/v1/stream/realtime`
3. Receive `directive` messages → update real-time gauges (signals, VAD, emotion)
4. Live transcript shows per-chunk text with speaker badges and emotion chips
5. On stop → server returns `session_end` with full aligned transcript → renders turn-by-turn view

---

## 10. Infrastructure & CI/CD

### Deployment Targets

| Component | Platform | Trigger |
|-----------|----------|---------|
| API (FastAPI) | Google Cloud Run | Git push to `master` (GitHub Actions) |
| Model (ProsodySSM) | Baseten (Truss) | Manual `truss push` |
| Website (Next.js) | Vercel | Git push to `main` |
| SDK | npm | Tag-triggered workflow |
| Training | Baseten Training (H100) | Manual `truss train push` |

### CI/CD Pipeline (`.github/workflows/deploy.yml`)

```
Push to master → Checkout (with submodules)
  → Setup Python 3.11
  → pip-audit + safety scan (SOC II)
  → GCP Workload Identity Federation auth
  → Docker build (api/Dockerfile)
  → Push to Artifact Registry (us-central1-docker.pkg.dev/prosodyssm/prosody/api:{sha})
  → Push :latest tag
  → gcloud run deploy prosody-api
      --region us-central1
      --platform managed
      --allow-unauthenticated
      --set-env-vars DATABASE_URL, MODEL_ID, CORS_ORIGINS, ...
```

### Terraform Infrastructure

| Resource | Details |
|----------|---------|
| **Cloud Run** | `prosody-api`, min 0 / max 10 instances, 512Mi / 1 CPU, port 8080, cpu_idle=true |
| **HTTPS LB** | Global external managed, Google-managed SSL cert for `api.prosodyai.app` |
| **VPC** | Serverless VPC Access connector, subnet `10.78.0.0/28` |
| **Artifact Registry** | `prosody` (Docker) |
| **GCS Buckets** | datasets, models, staging (with lifecycle rules) |
| **KMS** | Key ring + storage key for encryption at rest |
| **IAM** | Service accounts for API, training, model, GitHub deploy (WIF) |
| **GKE** | Cluster + GPU node pool (optional, for training) |

---

## 11. Database Schema

### Core Tables (Prisma)

```
Organization ──┬── User (role: SUPERADMIN|ADMIN|MEMBER|VIEWER)
               ├── ApiKey (keyHash, keyPrefix, rateLimit, expiresAt)
               ├── Kpi ──── KpiOutcome (sessionId, scalar/boolean/category value)
               ├── Transcript (source, audioUrl, text, analysisResult JSON)
               ├── Taxonomy ── TaxonomyState (baseEmotion, properties)
               ├── Integration (type: CRM/ASR/TTS/webhook, config JSON)
               ├── FineTuneJob (status, gcpJobId, metrics)
               └── UsageEvent (type, metadata)
```

### KPI System Tables

```sql
Kpi {
  id, name, type (SCALAR|BINARY|CATEGORICAL),
  direction (HIGHER_IS_BETTER|LOWER_IS_BETTER),
  rangeMin, rangeMax, categories[],
  alertThreshold, alertDirection (ABOVE|BELOW),
  enabled, organizationId
}

KpiOutcome {
  id, sessionId, kpiId,
  scalarValue?, booleanValue?, categoryValue?,
  createdAt
}
```

### API-Written Tables (SQL, not in Prisma)

```sql
ConversationSession { id, organizationId, metadata JSONB, createdAt }
ConversationTranscript { id, sessionId, organizationId, content, language }
ConversationAudio { id, sessionId, organizationId, storagePath, durationSeconds, format }
```

---

## 12. End-to-End Data Flow

### Real-Time Streaming Session

```
1. Client connects WS /v1/stream/realtime
2. Client sends: { type: "config", api_key: "...", session_id: "..." }
3. Server: validate key → load org KPIs → create DB session → config_ack
4. [Optional] Client sends: { type: "enroll_agent", audio_base64: "..." }
5. Server: compute resemblyzer embedding → agent voice enrolled → enroll_agent_ack

6. Client streams: binary PCM chunks (16kHz mono Int16, 2s each)
7. Server per chunk:
   a. Buffer until 64KB (2s)
   b. RMS gate (skip silence)
   c. Parallel: Baseten model inference + OpenAI Whisper transcription
   d. Speaker detection (resemblyzer cosine similarity)
   e. EMA temporal smoothing
   f. Accumulate TranscriptSegment
   g. Build AgentDirective
   h. Compute KPI predictions (heuristic)
   i. Send JSON directive to client + broadcast to observers

8. Client sends: { type: "end" }
9. Server:
   a. Merge segments → turns (consecutive same-speaker)
   b. Upload WAV + aligned transcript JSON to GCS
   c. Send session_end with full transcript to client
   d. Clean up session state
```

### GCS Storage Layout

```
gs://prosodyai-org-data/
  └── {org_slug}/
      ├── audio/
      │   └── {session_id}.wav          # Full session PCM as WAV
      └── transcripts/
          └── {session_id}.json         # Aligned transcript with turns + segments + prosody summary
```

### Feedback Loop

```
1. Client submits KPI outcomes: POST /v1/feedback/session_outcome
   { session_id, outcomes: [{ kpi_id, scalar_value?, boolean_value?, category_value? }] }

2. Server writes KpiOutcome rows to PostgreSQL

3. [Future] Training pipeline reads KpiOutcome data to train neural KPI head
   → Model learns client-specific outcome patterns from prosodic representations
   → Deployed model returns neural KPI predictions alongside heuristic ones
```

---

## Feature Extraction Details

### Prosodic Features (`api/feature_extraction.py`)

| Feature | Method | Output |
|---------|--------|--------|
| **F0 (pitch)** | `librosa.pyin` (fmin=50, fmax=500 Hz) | mean, std, min, max, range, contour |
| **Energy** | RMS per frame | mean, std, contour |
| **Jitter** | RAP-style: `mean(|ΔT|) / mean(T)` from F0 periods | scalar |
| **Shimmer** | Hilbert envelope peak perturbation (25ms/10ms hop) | scalar |
| **HNR** | Autocorrelation on 40ms frame, `10·log₁₀(peak/(origin-peak))` | dB, clipped [-20, 40] |
| **Speech rate** | Onset detection / duration | onsets/sec |
| **Spectral centroid** | `librosa.feature.spectral_centroid` | mean Hz |
| **Spectral rolloff** | `librosa.feature.spectral_rolloff` | mean Hz |
| **MFCCs** | `librosa.feature.mfcc` (n_mfcc=13) | 13-dim mean vector |

### Phonetic Features

- **Phonemizer** (espeak backend) → IPA phoneme sequence
- Vowel/consonant ratios from IPA character classification
- Stressed syllable count (IPA `ˈ` markers)
- Optional word-level alignment for timing

---

## ConversationPredictor (not yet deployed)

GRU-based forward-looking conversation outcome predictor that operates on a rolling window of per-utterance summaries.

### Input

- `(B, T_utterances, 12)` — 8 emotion probabilities + 3 VAD + 1 confidence per utterance

### Architecture

```
Linear(12, 64) → LayerNorm → GELU → Dropout
  → GRU(64, 64, num_layers=2, bidirectional=False)
  → LayerNorm → Linear(64, 64) → GELU → Dropout (shared trunk)
  → Per-head Linear(64, 1) or Linear(64, 6)
```

### Outputs (per timestep)

| Head | Range | Loss |
|------|-------|------|
| `will_escalate` | [0, 1] sigmoid | BCE |
| `escalation_onset` | [0, 1] sigmoid | BCE |
| `churn_risk` | [0, 1] sigmoid | BCE |
| `resolution_prob` | [0, 1] sigmoid | BCE |
| `deal_close_prob` | [0, 1] sigmoid | BCE |
| `intervention_needed` | [0, 1] sigmoid | BCE |
| `final_csat` | [1, 5] clamped | MSE |
| `sentiment_forecast` | [-1, 1] tanh | MSE |
| `tone_logits` | (6 classes) | CE |

Step weighting: \( w_t = 0.5 + 0.5 \cdot (t/T) \) — later timesteps weighted more heavily.
