# ProsodyAI: Streaming-Capable Prosodic Analysis for Voice Applications

## Abstract

ProsodyAI is a speech analysis system that turns short audio chunks into affective and prosodic signals for voice agents, call analysis, and downstream business workflows. The current deployed system accepts base64-encoded audio, resamples it to 16 kHz when needed, runs a ProsodySSM model on Baseten, and returns an emotion label, emotion probabilities, confidence, valence, arousal, dominance, and model-derived prosodic signal scores. This paper describes the inference contract and system design; it does not make measured QPS, latency, or capacity claims.

The production path is not an end-to-end trained KPI forecasting model. Instead, KPI support exists as an application layer: clients define KPIs in the dashboard, the API can collect outcome feedback by session, and a heuristic KPI predictor can map prosodic signals to provisional KPI estimates. The codebase also contains the architectural hooks for a conditional KPI head, but the KPI head is not yet trained end to end on client outcome data.

## 1. System Overview

ProsodyAI is organized as a multi-service platform:

- A Truss deployment on Baseten hosts the ProsodySSM inference model.
- A FastAPI service calls the model, handles batch and streaming workflows, and exposes results to clients.
- A Next.js dashboard owns organization, API key, KPI, and feedback configuration.
- PostgreSQL stores dashboard and feedback data, including client-defined KPI metadata and session outcomes.

At runtime, the primary inference contract is:

```text
audio chunk -> ProsodySSM -> emotion + VAD + prosodic signals
```

For streaming, the API accumulates PCM audio into short chunks, calls the deployed model, smooths the returned emotion probabilities and VAD values with an exponential moving average, adds optional transcription and speaker labels, and returns an agent directive.

## 2. Deployed Model Behavior

The deployed Baseten model is defined by the Truss custom model in `deploy/`. It expects an `audio_base64` field, decodes the audio to a temporary WAV file, reads it with `soundfile`, resamples non-16 kHz audio with `librosa`, and rejects clips shorter than 0.1 seconds at 16 kHz.

The model loads weights from one of the configured checkpoint sources, in priority order:

1. `MODEL_URL` or the `prosodyai_model_url` Baseten secret.
2. `MODEL_PATH`.
3. Bundled files in the Truss data directory.
4. A Baseten training checkpoint directory when present.

The current prediction response contains:

- `emotion`: the top emotion after confidence-based neutral suppression.
- `confidence`: the probability associated with the selected emotion.
- `emotion_probabilities`: the full distribution over configured emotion labels.
- `valence`: clipped to `[-1, 1]`.
- `arousal`: rescaled from model output to `[0, 1]`.
- `dominance`: rescaled from model output to `[0, 1]`.
- `signals`: interpreted scalar scores from the model output.
- `sequence_signals`: optional pooled sequence-level signals when the model returns them.

The model does not perform speech recognition. Transcription is handled separately by the API streaming pipeline and then attached to the same chunk-level directive.

## 3. ProsodySSM Architecture

ProsodySSM is a speech prosody model that combines a pretrained speech representation backbone with state-space temporal modeling. The intended architecture uses WavLM-derived acoustic representations, projects them into a lower-dimensional sequence representation, passes them through Mamba-style state-space blocks, and reads out task-specific heads.

The deployed interface treats the model as a raw acoustic inference service. Its stable outputs are emotion classification, VAD regression, and prosodic signal scores. The broader model package includes additional components, including optional sequence heads, speaker-adversarial training hooks, and a conditional KPI head, but only the emotion, VAD, and signal outputs are part of the current production inference contract.

## 4. Streaming Pipeline

The FastAPI streaming pipeline is built around short, repeated inference calls rather than a single long utterance pass. It:

1. Accepts streamed audio in PCM-style encodings.
2. Buffers audio into two-second, 16 kHz mono chunks.
3. Skips chunks below the voice activity energy threshold.
4. Sends each active chunk to the Baseten model.
5. Smooths emotion probabilities, confidence, valence, arousal, dominance, and signal values over time.
6. Optionally enriches the directive with transcription, speaker assignment, phonemes, IPA text, and a compact prosody embedding.

This produces agent-facing directives with fields such as `emotion`, `confidence`, `valence`, `arousal`, `dominance`, `speaker_id`, `signals`, `sequence_signals`, and transcript text.

## 5. KPI Layer

ProsodyAI supports client-defined KPIs at the product and API layer. A client can define KPIs such as CSAT, escalation, deal outcome, or engagement, then submit real outcomes later using the same `session_id`. These outcome records can become training data for future learned KPI models.

The current KPI predictor is heuristic. It consumes prosodic signals such as valence, arousal, dominance, pitch, energy, speech rate, jitter, shimmer, harmonic-to-noise ratio, and spectral features when available. It can produce a predicted value, confidence, trajectory, impact factors, alerts, and recommended actions.

This is useful for early product workflows and explainable demos, but it should not be described as a trained client-specific KPI model. The repository documents the next step: build a manifest that joins audio or prosody features with submitted KPI outcomes, then train the KPI head or another supervised model on those labels.

## 6. Training and Deployment

Training is designed to run on Baseten GPU infrastructure with data read from Google Cloud Storage. The documented training path downloads public emotion and VAD datasets, trains the ProsodySSM model, writes checkpoints to Baseten storage, and deploys a selected checkpoint through the custom Truss model.

Inference deployment uses:

- PyTorch 2.6 with CUDA 12.4.
- Prebuilt `causal-conv1d` and `mamba-ssm` wheels.
- The `prosody-ssm` package from the model repository.
- Baseten L4 GPU resources.
- Secrets for model checkpoint URLs and optional GCP credentials.

The API deployment is separate from the model deployment. The API is configured with the Baseten model ID, API key, and deployment environment so it can call the dedicated model endpoint.

## 7. Current Limitations

The current system should be described with these limits:

- KPI predictions are heuristic unless a separate supervised training path has been completed for a client.
- The model response does include emotion labels; the system is not VAD-only.
- ASR is not produced by the Baseten model and is handled separately by the API.
- Public dataset pretraining does not by itself validate enterprise KPIs such as CSAT, escalation, churn, or deal probability.
- Streaming outputs are chunk-level estimates with smoothing, not full-conversation judgments unless an application layer aggregates them.
- Throughput, QPS, and latency depend on Baseten deployment size, cold starts, API concurrency, chunk duration, and downstream ASR; they should be reported only from environment-specific load tests.
- Confidence thresholds intentionally suppress uncertain negative or rare emotions to neutral.

## 8. Practical Use

ProsodyAI is best understood today as a streaming-capable prosodic signal service. It gives applications a compact, chunk-by-chunk estimate of how speech sounds: emotional class probabilities, VAD values, and interpretable signal scores. Those signals can drive agent adaptation, escalation heuristics, post-call review, and the collection of labeled outcome data for later KPI model training.

The clearest product claim is therefore:

```text
ProsodyAI converts speech audio into chunk-level emotion, VAD, and prosodic signal estimates, with infrastructure for client-defined KPI feedback and future supervised KPI training.
```
