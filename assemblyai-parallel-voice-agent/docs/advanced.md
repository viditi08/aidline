# Setup reference

## Troubleshooting

- **Saw a console deprecation notice?** The locked LiveKit version supports this command. Wait for the greeting before speaking or typing.
- **No transcript or no sound?** Add `--text` to the console command. To choose a microphone or speaker, run `uv run python src/agent.py console --list-devices`, then pass `--input-device` or `--output-device` with its name. Check your terminal's microphone permission.
- **Gateway access error after the greeting?** Check your AssemblyAI key. If the error names a restricted gateway model, set `LLM_MODEL` in `.env.local` to an account-enabled option that supports streaming and tools. [AssemblyAI gateway options](https://www.assemblyai.com/docs/llm-gateway/available-models)
- **Web tool failed?** Check that the machine can reach `https://mcp.parallel.ai/mcp`. Anonymous limits can apply during discovery or mid-conversation, especially during repeated setup tests. If you hit the limit, wait and restart the agent, or set `PARALLEL_API_KEY` and restart for authenticated usage.

## Standalone API example

Set `PARALLEL_API_KEY` in `.env.local` to try direct Search and Decisions calls separately from the voice agent.

```sh
uv run python scripts/try_parallel.py "Find the latest stable Python release notes." --query "Python stable release notes"
uv run python scripts/try_parallel.py --decision "Python 3.13, python.org" "Does Python 3.13 offer a free-threaded build?"
```

## Browser or room

Install the LiveKit server and CLI first (on macOS, `brew install livekit livekit-cli`). Start the local server:

```bash
livekit-server --dev
```

```bash
uv run python src/agent.py dev
```

```bash
lk dispatch create --room test --agent-name parallel-search-agent
```

Then join room `test` from the [Agents Playground](https://agents-playground.livekit.io/)
(URL `ws://localhost:7880`, key `devkey`, secret `secret`), or publish an audio file as a
caller: `lk room join --identity caller --publish question.ogg test`.

> **If the agent logs `failed to connect to livekit ... 502`**, something in your shell
> has set `HTTPS_PROXY`. LiveKit's worker sends all traffic through that proxy, even
> to `localhost`. Some security tools that wrap `uv` set it for child processes. Run the
> agent with the venv's Python to skip the wrapper:
> `.venv/bin/python src/agent.py dev`.

## Deploy to LiveKit Cloud

```bash
lk cloud auth
lk agent create
```

This builds the [`Dockerfile`](../Dockerfile). Add `ASSEMBLYAI_API_KEY` as a secret (`lk agent update-secrets`). The deployed worker calls AssemblyAI directly, like the terminal demo.

To run a worker on your own machine against a LiveKit Cloud project, use `uv run python src/agent.py dev` with the project URL and credentials. The agent calls AssemblyAI and Parallel directly either way.

## Tune a voice session

Set `AGENT_METRICS=1` in `.env.local` and restart to see the original per-turn timing report alongside the transcript. If a reply feels slow, compare the end-of-utterance delay, time to the first LLM token, and time to the first byte of synthesized speech. The report prints the timings available for that turn.

Set `ASSEMBLYAI_TTS_VOICE` to change the speaking voice and `ASSEMBLYAI_STT_MODEL` to change the transcription model. It defaults to `universal-3-6-pro`. The voice defaults to `aai-kyla`; see the [voice list](https://github.com/tom-aai/assemblyai-livekit-tts#voices). For the standalone Search example, `PARALLEL_SEARCH_MODE`, `PARALLEL_MAX_RESULTS`, and `PARALLEL_MAX_CHARS` control the mode, result count, and excerpt budget. These three settings apply to the direct API example only.

## Tests

Run `uv run pytest`. Tests with configured keys make live API calls.

Speech playback and the latency reporter come from the [AssemblyAI streaming TTS plugin](https://github.com/tom-aai/assemblyai-livekit-tts).
