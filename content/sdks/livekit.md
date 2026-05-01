## Transcript-level anger/confusion analysis

The plugin can classify transcript turns alongside prosody events. Feed it text
from your LiveKit STT/transcription pipeline:

```python
from livekit_plugins_prosodyai import ProsodyAnalyzer

analyzer = ProsodyAnalyzer(model_path="/path/to/prosody/checkpoint")

analysis = analyzer.analyze_transcript(
    "wait, I don't understand why this is still broken",
    speaker_id="caller",
)

print(analysis.label)           # "angry_confused"
print(analysis.anger)           # 0.0 - 1.0
print(analysis.confusion)       # 0.0 - 1.0
print(analysis.escalation_risk) # 0.0 - 1.0
print(analysis.evidence)        # cue explanations
```

If you already have a `ProsodyEvent` for the same turn, attach the transcript
analysis directly:

```python
event = analyzer.attach_transcript(event, transcript_text, speaker_id="caller")
if event.transcript_analysis.label in {"angry", "confused", "angry_confused"}:
    # Escalate, slow down, ask a clarifying question, or route to a human.
    ...
```

This classifier is deterministic and fast. It is meant to complement the
prosody model: prosody catches tone, while transcript analysis catches semantic
signals like clarification requests, repeated confusion, explicit frustration,
profanity, refund/cancel intent, and escalation language.
