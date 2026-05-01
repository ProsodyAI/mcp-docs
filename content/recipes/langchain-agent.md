# Recipe: Wire ProsodyAI as a LangChain tool

Goal: give a LangChain agent the ability to listen to an audio file or live
session and reason about how the speaker sounds — separately from what they
said.

## 1. Install

```bash
pip install prosodyai-langchain langchain langchain-openai
```

## 2. Create the tool

```python
import os
from prosodyai_langchain import ProsodyTool

prosody_tool = ProsodyTool(
    api_key=os.environ["PROSODYAI_API_KEY"],
    vertical="contact_center",       # or healthcare, sales, education, ...
    session_id="conversation-42",     # required for forward predictions
)
```

The tool exposes a single argument schema: `{"audio_path": str}`. It returns
a markdown summary the LLM can quote in its reasoning, including:

- Primary affect and confidence
- Valence / arousal / dominance
- Forward predictions (escalation risk, predicted CSAT, recommended tone)

## 3. Use it in an agent

```python
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="gpt-4.1-mini", temperature=0)
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a QA reviewer. Use the prosody tool to ground your judgments in how the speaker sounds, not just the transcript."),
    ("placeholder", "{chat_history}"),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])
agent = create_openai_tools_agent(llm, [prosody_tool], prompt)
executor = AgentExecutor(agent=agent, tools=[prosody_tool])

executor.invoke({
    "input": "Score this call for empathy and escalation risk: ./calls/001.wav",
})
```

## 4. Multi-turn conversations

For a multi-utterance call, keep the same `session_id` between invocations.
Each call sharpens the forward predictions:

```python
prosody_tool.invoke({"audio_path": "segment_1.wav"})
prosody_tool.invoke({"audio_path": "segment_2.wav"})  # predictions sharpen
prosody_tool.invoke({"audio_path": "segment_3.wav"})
```

After the conversation ends, post the actual outcome with
`ProsodyClient.submit_session_outcome` (see `recipes/sdk-typescript-quickstart`
for the equivalent TS call).

## What to read next

- `read_doc id=sdks/langchain` — full README with every option.
- `read_doc id=recipes/kpi-flow` — define your own KPIs instead of using the
  built-in vertical defaults.
