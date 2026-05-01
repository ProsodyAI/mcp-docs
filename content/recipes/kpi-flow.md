# Recipe: Define and consume custom KPIs

ProsodyAI does **not** ship hard-coded "emotion" classes. Instead, you define
the KPIs you actually care about (e.g. `retention_intent`, `clinician_handoff`,
`buying_intent`, `authenticity_score`) in the dashboard, and the API returns
predictions for *those* KPIs from raw prosodic signal.

This recipe is the end-to-end flow: define → predict → close the loop.

## 1. Define your KPI schema (dashboard)

In the dashboard:

1. Open **Settings → KPIs**.
2. Click **New KPI**. Pick:
   - `name` (e.g. `retention_intent`)
   - `type`: `score` (continuous 0..1), `class` (categorical), or `regression`
   - `range` / `classes` as appropriate
3. Optional: provide labelled examples (`docs/KPI_LABELED_DATA.md`) — the more
   examples you upload, the faster the model adapts.

Once saved, the KPI is available immediately to your tenant's API key.

## 2. Predict against your KPIs

```ts
import { ProsodyClient } from "@prosodyai/sdk";

const client = new ProsodyClient(process.env.PROSODYAI_API_KEY!);

const result = await client.analyze("./call.wav", {
  sessionId: "call-123",
  kpis: ["retention_intent", "buying_intent", "authenticity_score"],
});

console.log(result.kpi_predictions);
// {
//   retention_intent:    { value: 0.82, confidence: 0.71 },
//   buying_intent:       { value: 0.41, confidence: 0.65 },
//   authenticity_score:  { value: 0.78, confidence: 0.83 },
// }
```

If you don't pass `kpis`, the API returns predictions for **all** KPIs
defined for your tenant.

## 3. Close the loop with real outcomes

Forward predictions only get better when you tell the API what actually
happened. Submit outcome rows from your CRM / survey / billing pipeline:

```ts
await client.feedback.submitKpiOutcome({
  sessionId: "call-123",
  kpi: "retention_intent",
  actualValue: 1, // user did renew
  observedAt: "2026-05-04T18:32:00Z",
});
```

This is what differentiates ProsodyAI from a static emotion classifier:
your KPIs improve over time *for your tenant* without retraining anything.

## 4. Reading: useful references

- `read_doc id=docs/KPI_EXAMPLES` — example KPI definitions for each vertical.
- `read_doc id=docs/KPI_LABELED_DATA` — schema for uploading labelled examples.
- `list_endpoints tag=Feedback` — REST endpoints for outcome ingestion.
- `list_endpoints tag=Analysis` — REST endpoints for prediction.

## Common mistakes

- **Reusing `session_id` across calls.** A session is one conversation. Use
  a new id per call.
- **Sending outcomes too late.** The API will accept them at any time, but
  outcomes within ~24h of the prediction give the model the strongest signal.
- **Treating KPI predictions as binary at low confidence.** When `confidence`
  is below ~0.6, surface the value as a hint, not a verdict.
