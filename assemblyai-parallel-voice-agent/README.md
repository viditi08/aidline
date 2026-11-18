# AidLine

AidLine is a voice assistant that helps people in San Francisco find food and utility assistance. AssemblyAI handles speech and replies. Parallel’s hosted MCP server gives the agent three tools: Search finds current official pages, Fetch reads a particular public page, and Decisions estimates a probability when someone asks for one. The first conversation only needs an AssemblyAI key. [Parallel MCP](https://docs.parallel.ai/integrations/mcp/quickstart)

AidLine does not apply for benefits, decide eligibility, or ask for Social Security numbers, bank details, or card numbers. It only covers San Francisco.

## Run it

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then open a terminal:

```sh
git clone https://github.com/hsingh-aai/assemblyai-parallel-voice-agent.git
cd assemblyai-parallel-voice-agent
uv sync --frozen
```

Copy `.env.example` to `.env.local`. Set `ASSEMBLYAI_API_KEY` with your [AssemblyAI key](https://www.assemblyai.com/dashboard). Leave `PARALLEL_API_KEY` empty for free, rate-limited MCP access.

```sh
uv run python src/agent.py console --log-level info
```

Allow microphone access and wait for the greeting. To type instead, add `--text` to the command. Press Ctrl+C to quit.

### Hit the free-tier rate limit?

1. Press Ctrl+C to stop the agent. Get a key from the [Parallel dashboard](https://platform.parallel.ai).
2. Open the existing `.env.local` in the repo folder. Find `PARALLEL_API_KEY=`, paste your key after the equals sign, and save the file.
3. Run the same console command again and repeat your question. On startup, the agent picks up your key and uses your Parallel account for Search, Fetch, and Decisions. No code changes are needed.

## Demo

Use text mode if the microphone is unavailable: add `--text`.

1. “I need food for my kids today.” Then give a San Francisco ZIP code such as 94103.
2. “I lost my job and need grocery assistance.”
3. “My electricity might get cut off tomorrow.”
4. “I don't know if I qualify for food assistance.”
5. “Are these places open today?”

The agent should search before stating hours, phone numbers, or eligibility, and it should say when a source did not list a fact. A slow lookup is announced as “Searching trusted assistance resources.”

## Make it yours

Both Search and Decisions are already connected. Start with a pair of questions about the same subject. “Does Python 3.13 support free threading?” is a factual lookup. “Classify that support as stable, experimental, or explicitly unsupported” asks for a decision against supplied options. [See the prompt and tool input for this example](docs/decision-prompts.md).

Try a library compatibility assistant. Set `AGENT_GREETING="Which library are you working with?"` in `.env.local`. Add “Prefer official release notes and package metadata” to `INSTRUCTIONS` in [src/agent.py](src/agent.py). Restart and try similar questions about a library you use.

**Standalone API example.** To call Parallel directly from your own app, set `PARALLEL_API_KEY` with a [Parallel key](https://platform.parallel.ai). [parallel_api.py](src/parallel_api.py) has the two API calls and only needs `parallel-web`. [try_parallel.py](scripts/try_parallel.py) shows how to use them.

[Setup help](docs/advanced.md#troubleshooting) · [Browser and deployment options](docs/advanced.md#browser-or-room)
