# Production image for `lk agent create` / `lk agent deploy` on LiveKit Cloud.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

COPY src ./src
RUN uv run --frozen --no-dev python src/agent.py download-files

CMD ["uv", "run", "--no-dev", "python", "src/agent.py", "start"]
