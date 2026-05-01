# Getting KPI-labeled data

To train the KPI head you need **(audio or prosody features) + (actual KPI outcomes)**. Outcomes are sent via the feedback API; the same `session_id` links a conversation to its labels.

---

## 1. Define KPIs in the dashboard

In the Next.js dashboard (prosodyai-website), create the KPIs you want to predict, e.g.:

- **CSAT** (SCALAR, 1–5, higher is better)
- **Escalated** (BINARY, lower is better)
- **Deal closed** (BINARY, higher is better)

Each KPI gets a **kpi_id** (UUID). You’ll use that when submitting outcomes.

---

## 2. Send audio with a session ID

When you send audio for analysis, pass a **session_id** so later you can attach outcomes to that session.

**REST example:**

```bash
curl -X POST "https://your-api/v1/analysis/analyze" \
  -H "Authorization: Api-Key YOUR_API_KEY" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@call_recording.wav" \
  -F "session_id=session_abc123"
```

**SDK (TypeScript):** pass `session_id` in the analyze options if the client supports it.

The API returns predictions and a `prediction_id`. Store `session_id` in your backend (e.g. CRM or call system) so you can later send outcomes for that call.

---

## 3. Submit KPI outcomes after the conversation

When you know the real outcome (e.g. post-call survey CSAT, or “escalated” from your CRM), POST to the feedback endpoint with the **same session_id** and the KPI values.

**Endpoint:** `POST /v1/feedback/session_outcome`

**Body:**

```json
{
  "session_id": "session_abc123",
  "outcomes": [
    {
      "kpi_id": "uuid-of-csat-kpi",
      "scalar_value": 4.0
    },
    {
      "kpi_id": "uuid-of-escalated-kpi",
      "boolean_value": false
    }
  ],
  "notes": "optional"
}
```

- **Scalar KPI:** use `scalar_value` (number), leave others null.
- **Binary KPI:** use `boolean_value` (true/false).
- **Categorical KPI:** use `category_value` (string, one of the KPI’s categories).

**Example (curl):**

```bash
curl -X POST "https://your-api/v1/feedback/session_outcome" \
  -H "Authorization: Api-Key YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "session_abc123",
    "outcomes": [
      {"kpi_id": "YOUR_CSAT_KPI_UUID", "scalar_value": 4},
      {"kpi_id": "YOUR_ESCALATED_KPI_UUID", "boolean_value": false}
    ]
  }'
```

Outcomes are stored in:

- **PostgreSQL** `KpiOutcome` table: `(sessionId, kpiId, scalarValue, booleanValue, categoryValue)`
- **JSONL** (GCS or local): `feedback/session_outcomes/YYYY-MM-DD.jsonl` for audit

---

## 4. Building a dataset for KPI-head training

You need a **manifest** that pairs each session with (1) audio or precomputed prosody and (2) outcome labels.

**Option A – From your database**

1. Query sessions that have both:
   - Audio (or a pointer to it: path, GCS URI, etc.)
   - At least one row in `KpiOutcome` for that `sessionId`
2. Join `KpiOutcome` to get, per session, each `kpiId` and its value (`scalarValue`, `booleanValue`, or `categoryValue`).
3. Build a JSON manifest, e.g.:

```json
[
  {
    "session_id": "session_abc123",
    "audio_path": "gs://bucket/recordings/session_abc123.wav",
    "outcomes": [
      {"kpi_id": "uuid-csat", "scalar_value": 4.0},
      {"kpi_id": "uuid-escalated", "boolean_value": false}
    ]
  }
]
```

**Option B – From JSONL feedback logs**

If you use GCS/local JSONL for `session_outcomes`, each line is one submission. You still need to join to session/audio (e.g. by `session_id`) from your own store or from analysis logs that record `session_id` and audio location.

**Option C – Bulk import from CSV**

If outcomes live in a CSV (e.g. from a survey or CRM export), create a small script that:

1. Reads CSV columns: `session_id`, `audio_path` (or `recording_id`), `csat`, `escalated`, …
2. Maps columns to your KPI IDs.
3. Either:
   - Calls `POST /v1/feedback/session_outcome` for each row (so data lands in the DB and JSONL), or
   - Writes a training manifest JSON that your training script can read (and that points to audio paths or prosody cache).

---

## 5. Training the KPI head (next step)

The ProsodySSM codebase has a **KPI head** and `compute_kpi_loss` in `prosody_ssm/model.py`. There is no end-to-end “KPI training” script yet that:

- Reads a manifest of (session/audio, outcomes),
- Loads or computes prosody (e.g. from the emotion-pretrained backbone),
- Trains the KPI head with `compute_kpi_loss`.

To get KPI-labeled data **into** the system: use the same `session_id` for analysis and for `session_outcome`, then export from the DB or JSONL (or bulk-import from CSV) into a manifest. Once you have that manifest, you can wire it into a training loop that loads audio, runs the backbone, and trains the KPI head on your outcomes.
