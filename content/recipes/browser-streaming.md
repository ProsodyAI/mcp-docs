# Recipe: Stream prosody from a browser

Goal: capture mic audio in the browser, stream it to the ProsodyAI realtime
endpoint, and react to escalation alerts in the UI (e.g. show a "calm down"
indicator, switch the agent's persona, or surface a coach card).

This is the pattern many voice dashboards use for live coaching.

## 1. Install

```bash
npm install @prosodyai/sdk
```

## 2. Capture mic audio

Use the standard `MediaStream` API and downsample to 16 kHz mono PCM. The
SDK ships a helper for the AudioWorklet path; if you can't use a worklet,
use a manual `ScriptProcessor` fallback.

```ts
import { ProsodyClient, createMicWorklet } from "@prosodyai/sdk";

const client = new ProsodyClient(import.meta.env.VITE_PROSODYAI_KEY);

async function start() {
  const sessionId = `web-${crypto.randomUUID()}`;
  const stream = client.createRealtimeStream({
    sessionId,
    vertical: "contact_center",
    chunkDuration: 3,
    onResult: (r) => updateVadHud(r),
    onEscalationAlert: (a) => triggerCoachCard(a),
    onError: (e) => console.error(e),
  });
  await stream.connect();

  const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  const worklet = await createMicWorklet({
    mediaStream: mic,
    onPcm: (pcm) => stream.send(pcm),
  });
  return { stream, worklet, sessionId };
}
```

## 3. React to events

```ts
function updateVadHud(r) {
  // r.valence ∈ [-1, 1], r.arousal ∈ [0, 1], r.dominance ∈ [0, 1]
  document.getElementById("valence")!.style.setProperty("--v", String(r.valence));
}

function triggerCoachCard(alert) {
  showToast(`Caller is escalating — try ${alert.recommended_tone}`);
}
```

## 4. Stop cleanly

Always call `stream.end()` before `mic.getTracks().forEach(t => t.stop())`,
otherwise the last 1-2 seconds of the conversation won't be analyzed.

## 5. Submit the outcome

When the call wraps (CSAT survey returns, agent marks resolved, etc.), POST
to `/v1/feedback/session_outcome` with the same `sessionId`.

## Edge cases

- **Sample rate**: WavLM expects 16 kHz mono. The worklet helper resamples
  for you; if you write your own pipeline, downsample explicitly.
- **Permissions**: gracefully handle `NotAllowedError` from `getUserMedia`.
- **Network drops**: the realtime stream auto-reconnects with exponential
  backoff. Treat `onError` calls as informational — don't reset state on
  every transient failure.
- **Privacy**: ProsodyAI processes audio for VAD/KPI prediction only; if you
  need to disclose this in the UI, do so before `getUserMedia` is called.

## What to read next

- `read_doc id=sdks/typescript` — full SDK README.
- `read_doc id=recipes/livekit-realtime-agent` — the equivalent for a
  LiveKit-mediated call (Python).
