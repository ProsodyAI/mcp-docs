# Quickstart: TypeScript SDK

Use this when adding ProsodyAI to a Node, Next.js, or browser app (e.g. a web client or Vercel function).

## 1. Install

```bash
npm install @prosodyai/sdk
```

## 2. Get an API key

Create one in the ProsodyAI dashboard (`https://prosodyai.app`) → API Keys.
For local dev, set:

```bash
export PROSODYAI_API_KEY=pk_live_...
```

## 3. One-shot analysis (file or buffer)

```ts
import { ProsodyClient } from "@prosodyai/sdk";

const client = new ProsodyClient(process.env.PROSODYAI_API_KEY!);

const result = await client.analyze("./call.wav", {
  vertical: "contact_center",
  sessionId: "call-123", // optional — needed for forward predictions
});

console.log(result.valence, result.arousal, result.dominance);
console.log(result.forward_predictions?.will_escalate);
```

## 4. Streaming from a Node process or browser

For a live conversation (LiveKit, Twilio, browser mic, etc.) push 3-second
chunks of 16 kHz PCM into the realtime stream:

```ts
const stream = client.createRealtimeStream({
  sessionId: "call-123",
  vertical: "contact_center",
  chunkDuration: 3,
  onResult: (r) => console.log("VAD:", r.valence, r.arousal),
  onEscalationAlert: (a) =>
    console.warn(`Escalating; recommend tone=${a.recommended_tone}`),
});

await stream.connect();
await stream.send(audioBuffer); // Float32Array or Int16Array PCM
await stream.end();
```

## 5. Close the loop

When the conversation is over, report the actual outcome so forward
predictions improve over time:

```ts
await client.feedback.submitSessionOutcome({
  sessionId: "call-123",
  vertical: "contact_center",
  actualCsat: 4.2,
  escalated: false,
  firstCallResolved: true,
});
```

## What to read next

- `read_doc id=sdks/typescript` — full SDK README with every option.
- `read_doc id=docs/SYSTEMS` — env contract and how the API + dashboard share state.
- `list_endpoints` — REST endpoints if you don't want to use the SDK.
