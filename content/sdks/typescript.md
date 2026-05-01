# @prosodyai/sdk

ProsodyAI SDK for speech emotion analysis with forward-looking conversation predictions. Supports files, buffers, real-time streaming, and feedback for continuous model improvement.

## Installation

```bash
npm install @prosodyai/sdk
```

## Usage

### Basic Analysis

```typescript
import { ProsodyClient } from '@prosodyai/sdk';

const client = new ProsodyClient('your-api-key');

// Analyze audio file
const result = await client.analyze('./audio.wav');
console.log(result.emotion);        // { primary: 'happy', confidence: 0.92, ... }
console.log(result.prediction_id);  // 'pred-abc123'
console.log(result.valence);        // 0.7
```

### Conversation Tracking with Forward Predictions

Track a conversation to get forward-looking predictions -- escalation risk, CSAT forecast, churn risk, and recommended agent tone.

```typescript
const client = new ProsodyClient('your-api-key');

// Use sessionId to track state across utterances
const result = await client.analyze('./segment_1.wav', {
  vertical: 'contact_center',
  sessionId: 'call-12345',
});

console.log(result.forward_predictions);
// {
//   will_escalate: 0.73,
//   escalation_onset: 0.12,
//   final_csat_predicted: 2.1,
//   churn_risk: 0.45,
//   resolution_probability: 0.28,
//   sentiment_forecast: -0.6,
//   recommended_tone: 'calm',
//   prediction_confidence: 0.81,
//   utterances_seen: 5,
// }
```

### Real-time Streaming with Escalation Alerts

```typescript
const client = new ProsodyClient('your-api-key');

const stream = client.createRealtimeStream({
  sessionId: 'call-12345',
  vertical: 'contact_center',
  chunkDuration: 3,
  onResult: (result) => {
    console.log(`Emotion: ${result.emotion.primary}`);
    if (result.forward_predictions) {
      console.log(`Escalation risk: ${result.forward_predictions.will_escalate}`);
    }
  },
  onEscalationAlert: (alert) => {
    // Fired when escalation onset is detected in real-time
    console.warn(`ESCALATION ONSET: ${alert.onset_probability}`);
    console.warn(`Recommended tone: ${alert.recommended_tone}`);
    // Trigger de-escalation workflow here
    triggerDeEscalation(alert);
  },
  onError: (error) => console.error(error),
});

await stream.connect();

// Feed audio frames (from Web Audio API, LiveKit, etc.)
processor.onaudioprocess = (e) => {
  stream.send(e.inputBuffer.getChannelData(0));
};
```

### PCM Buffer Analysis

```typescript
const pcmSamples = new Float32Array(audioBuffer);
const result = await client.analyzePCM(pcmSamples, {
  sampleRate: 16000,
  channels: 1,
  sessionId: 'call-12345',
});
```

### Voice AI Integration

```typescript
// Works with LiveKit, Daily, Twilio, etc.
const stream = client.createRealtimeStream({
  sessionId: callId,
  vertical: 'contact_center',
  onResult: updateDashboard,
  onEscalationAlert: triggerDeEscalation,
});

await stream.connect();

function onAudioFrame(frame: Float32Array) {
  stream.send(frame);
}

// When call ends
await stream.end();
```

### Feedback for Continuous Improvement

```typescript
const client = new ProsodyClient('your-api-key');

// Correct a wrong prediction
await client.submitCorrection({
  predictionId: 'pred-abc123',
  correctEmotion: 'angry',
});

// Submit conversation outcome (trains forward predictions)
await client.submitSessionOutcome({
  sessionId: 'call-12345',
  vertical: 'contact_center',
  actualCsat: 2.0,
  escalated: true,
  firstCallResolved: false,
  churned: true,
});

// Submit per-prediction outcome
await client.submitOutcome({
  predictionId: 'pred-abc123',
  vertical: 'contact_center',
  actualCsat: 2.0,
});
```

### Fine-Tuning

```typescript
const job = await client.createFineTune({
  name: 'customer-support-model',
  vertical: 'customer_service',
  epochs: 10,
});

await client.uploadFineTuneSamples(job.id, [
  { audioUrl: 'https://...', emotion: 'frustrated' },
  { audioUrl: 'https://...', emotion: 'satisfied' },
]);

await client.startFineTune(job.id);

const status = await client.getFineTune(job.id);
console.log(status.progress);  // 0.75
```

## Examples

A **live mic test page** that records in the browser and sends audio to the Baseten ProsodySSM endpoint is in this package:

```bash
cd packages/sdk && npm run example
```

Then open **http://localhost:3000/examples/live-baseten.html**, enter your Baseten API key, and click Record and send. See [examples/README.md](examples/README.md) for details.

## API

### `new ProsodyClient(apiKey)`
Create a client with your API key.

### `client.analyze(audio, options?)`
Analyze audio file or buffer. Options: `language`, `vertical`, `sessionId`, `includeFeatures`.

### `client.analyzePCM(pcmData, options?)`
Analyze raw PCM samples (Int16Array, Float32Array, or ArrayBuffer).

### `client.createStream(options?)`
Create a REST-based streaming analyzer.

### `client.createRealtimeStream(options?)`
Create a WebSocket streaming analyzer with `onEscalationAlert` callback.

### `client.analyzeBase64(base64, options?)`
Analyze base64-encoded audio.

### `client.extractFeatures(audio)`
Extract prosodic features only.

### `client.submitCorrection(options)`
Submit a label correction for a prediction.

### `client.submitOutcome(options)`
Submit a per-prediction real-world outcome.

### `client.submitSessionOutcome(options)`
Submit how a conversation ended (primary signal for forward predictions).
