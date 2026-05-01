# Example KPIs for ProsodyAI

Use these when defining KPIs in the dashboard or when training the KPI head. Each needs **outcome labels** (post-call / post-session) to train the model; until then the API uses heuristic mapping from prosody.

Your model supports three types: **SCALAR**, **BINARY**, **CATEGORICAL**. Direction: **HIGHER_IS_BETTER** or **LOWER_IS_BETTER**.

---

## Scalar (continuous in a range)

| KPI name       | Range   | Direction | Where you get the label              |
|----------------|--------|-----------|--------------------------------------|
| **CSAT**       | 1–5    | Higher    | Post-call survey                     |
| **NPS**        | -100–100| Higher    | Post-call survey                     |
| **Quality score** | 0–100 | Higher    | QA rubric / reviewer                 |
| **Handle time**   | 0–3600 (sec) | Lower | ACD / CRM                            |
| **First-call resolution** | 0–1 or 0–100% | Higher | CRM / resolution flag |
| **Engagement score** | 0–10 | Higher | Internal rubric / coach              |
| **Confidence** | 0–1    | Higher    | Coach / interviewer rating           |
| **Comprehension** | 0–1  | Higher    | Quiz score, coach rating             |

---

## Binary (yes/no)

| KPI name          | Direction | Where you get the label        |
|-------------------|-----------|--------------------------------|
| **Escalated**     | Lower     | CRM / ticketing (escalation flag) |
| **Deal closed**   | Higher    | CRM (won/lost)                 |
| **Churned**       | Lower     | Subscription / retention flag   |
| **Callback requested** | Lower | Callback / ticket created      |
| **Complaint filed**    | Lower | Complaints system             |
| **Sale made**     | Higher    | CRM / order created           |
| **Appointment booked** | Higher | Calendar / CRM               |
| **Resolved**      | Higher    | Resolution / case closed      |
| **Compliance pass**   | Higher | QA / compliance review        |

---

## Categorical (one of N labels)

| KPI name           | Categories (examples)                    | Where you get the label   |
|--------------------|------------------------------------------|---------------------------|
| **Call disposition** | Resolved, Escalated, Callback, Abandoned | CRM / wrap-up             |
| **Resolution type**  | Technical, Billing, General, Complaint   | Case type / tag           |
| **Sentiment outcome**| Positive, Neutral, Negative              | Survey or reviewer        |
| **Intent**          | Purchase, Support, Cancel, Upgrade       | Intent tag / outcome      |
| **Outcome**         | Success, Partial, Failure               | Internal definition       |

---

## Picking KPIs for training

1. **You must have ground truth** – Actual values after the conversation (survey, CRM, QA, flag). No labels → only heuristics.
2. **Start with 1–3** – One scalar (e.g. CSAT), one binary (e.g. escalated), optional one categorical (e.g. disposition).
3. **Same schema as dashboard** – Create these in the Next.js dashboard (Kpi table); the API reads them and the model head is conditioned on the same schema (type, direction, range/categories).

Once you have enough sessions with outcomes, you can train the KPI head with `(prosody_features, kpi_config, actual_outcome)` and deploy.
