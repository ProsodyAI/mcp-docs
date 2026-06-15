# Recipe: Add ProsodyAI to a LiveKit voice agent (Python)

Goal: a LiveKit `Agent` that listens to the caller's audio in real time,
streams it through ProsodyAI, and adapts its behaviour when the prosodic
signal changes (e.g. caller becomes frustrated → switch to empathetic tone,
trigger a de-escalation prompt, or hand off to a human).

## Prerequisites

- LiveKit Agents installed (`pip install livekit-agents`)
- A ProsodyAI API key (`PROSODYAI_API_KEY`)
- Optional: a custom KPI schema configured for your tenant in the dashboard

## 1. Install the plugin

```bash
pip install livekit-plugins-prosodyai
```

The plugin handles audio frame conversion (LiveKit `AudioFrame` → 16 kHz PCM)
and rate-limited dispatch to the ProsodyAI streaming endpoint.

## 2. Wire the analyzer into your agent

```python
import os
import uuid
from livekit.agents import Agent, AgentSession, AutoSubscribe, JobContext
from livekit_plugins_prosodyai import ProsodyAnalyzer

class SupportAgent(Agent):
    def __init__(self):
        super().__init__(
            instructions=(
                "You are a calm, empathetic customer-support agent. "
                "Adapt your tone based on the caller's prosodic state."
            ),
        )
        self.prosody = ProsodyAnalyzer(
            api_key=os.environ["PROSODYAI_API_KEY"],
            session_id=f"call-{uuid.uuid4()}",
            vertical="contact_center",
            chunk_duration=3.0,
        )

    async def on_enter(self):
        # session.input.audio_track is the caller's mic stream
        track = self.session.input.audio_track
        async for event in self.prosody.analyze_track(track):
            if event.steering:
                self.session.context.update(
                    prosody_steering=event.steering.system_prompt,
                )
            if event.modulation_mode == "caller_escalating":
                await self.session.say(
                    "I can hear how frustrating this is. Let me jump straight to a fix.",
                    interrupt=True,
                )
                # Optionally: trigger a transfer, log a CRM event, etc.
            elif event.kpi_predictions:
                # Tenant-defined KPI predictions, when configured.
                self.session.context.update(kpi_predictions=event.kpi_predictions)

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    session = AgentSession()
    await session.start(agent=SupportAgent(), room=ctx.room)
```

## 3. Close the feedback loop after the call

```python
async def on_session_end(session_id, csat_from_survey, escalated, fcr):
    from prosodyai_sdk import ProsodyClient
    client = ProsodyClient(os.environ["PROSODYAI_API_KEY"])
    await client.feedback.submit_session_outcome(
        session_id=session_id,
        vertical="contact_center",
        actual_csat=csat_from_survey,
        escalated=escalated,
        first_call_resolved=fcr,
    )
```

This is how the model improves its forward predictions over time — without
this, you only get instantaneous VAD readings.

## Production checklist

- Buffer audio to ≥ 3 second chunks before sending; shorter chunks degrade
  forward-prediction quality.
- Use one `session_id` per call; do **not** reuse session ids across calls.
- The plugin will back off on 429s; tune `chunk_duration` upward (5-7s) for
  high-volume call centers if you start to see them.
- Treat escalation alerts as an event stream, not a poll — don't block the
  TTS pipeline waiting for one.

## What to read next

- `read_doc id=sdks/livekit` — full plugin README (if bundled).
- `read_doc id=docs/STRUCTURE` — how sessions are stored.
- `read_doc id=recipes/kpi-flow` — defining custom KPIs (e.g. retention risk,
  authenticity) instead of contact-center defaults.
