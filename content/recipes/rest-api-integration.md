# Recipe: REST API integration without an SDK

When you can't (or don't want to) install an SDK — e.g. inside an Edge
Function, a different language, or a thin proxy — call the ProsodyAI REST
API directly.

Base URL: `https://api.prosodyai.app`
Auth: every `/v1/*` endpoint requires `X-API-Key: <your-key>`.

## 1. One-shot analysis (file upload)

```bash
curl -X POST https://api.prosodyai.app/v1/analyze/audio \
  -H "X-API-Key: $PROSODYAI_API_KEY" \
  -F "file=@call.wav" \
  -F "vertical=contact_center" \
  -F "session_id=call-123"
```

Returns JSON with `valence`, `arousal`, `dominance`, `prosody`, optional
`forward_predictions`, and (if your tenant defines them) `kpi_predictions`.

## 2. Analysis from URL or GCS

For audio that already lives somewhere addressable:

```bash
curl -X POST https://api.prosodyai.app/v1/analyze/url \
  -H "X-API-Key: $PROSODYAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://my-bucket/.../call.wav","vertical":"contact_center","session_id":"call-123"}'
```

`/v1/analyze/gcs` works the same with `gs://bucket/key`. Use this from inside
GCP for zero-egress analysis.

## 3. Streaming (WebSocket)

```
wss://api.prosodyai.app/v1/stream/ws
?api_key=<key>
&session_id=call-123
&vertical=contact_center
&sample_rate=16000
```

Send binary frames of 16 kHz mono PCM (Int16 little-endian). Receive JSON
messages:

```json
{ "type": "vad",   "valence": -0.4, "arousal": 0.7, "dominance": 0.5 }
{ "type": "alert", "kind": "escalation", "recommended_tone": "calm" }
{ "type": "kpi",   "name": "retention_intent", "value": 0.82, "confidence": 0.7 }
```

Send `{"type":"end"}` to flush the final chunk and close cleanly.

## 4. Submit outcomes

```bash
curl -X POST https://api.prosodyai.app/v1/feedback/session-outcome \
  -H "X-API-Key: $PROSODYAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session_id":"call-123","vertical":"contact_center","actual_csat":4.0,"escalated":false,"first_call_resolved":true}'
```

## 5. Discover endpoints with this MCP server

Rather than guessing routes, use:

- `list_endpoints` — all endpoints (filter by `tag` or `pathContains`)
- `get_endpoint method=POST path=/v1/analyze/audio` — full operation object,
  including parameter schemas, request body schema, response schemas, and
  required security.
- `get_openapi` — the entire spec, if you want to generate a client.

## Rate limits and errors

- 429 → exponential backoff with jitter. Headers: `X-RateLimit-Reset`.
- 401 → invalid / revoked API key.
- 413 → upload exceeds `PROSODYAI_MAX_FILE_SIZE` (default 50 MB). Use
  `/v1/analyze/url` or the streaming WS for longer audio.

## What to read next

- `read_doc id=sdks/api-fastapi` — full REST README from the API repo.
- `read_doc id=docs/SYSTEMS` — env contract and deployment topology.
