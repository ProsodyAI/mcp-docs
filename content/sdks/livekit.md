## LiveKit realtime prosody analysis

The plugin streams a LiveKit `AudioTrack` to the hosted ProsodyAI realtime
endpoint and yields `ProsodyEvent` directives:

```python
from livekit_plugins_prosodyai import ProsodyAnalyzer

analyzer = ProsodyAnalyzer(
    api_key="psk_...",
    session_id="call-123",
    vertical="contact_center",
)

async for event in analyzer.analyze_track(audio_track):
    print(event.session_id, event.emotion, event.valence, event.arousal)
    if event.steering:
        print(event.steering.system_prompt)
    if event.modulation_mode == "caller_escalating":
        print(event.tts_speed, event.tts_emotion)
```

Set `on_warning` to catch server-side diagnostics such as `audio_silent`, which
means the client is sending buffers but they contain only zeros.
