"""Reusable Search and Decisions calls. Requires only parallel-web."""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Literal

from parallel import AsyncParallel

logger = logging.getLogger("agent.parallel")

SearchMode = Literal["turbo", "fast", "basic", "advanced"]


@dataclass
class ParallelConfig:
    api_key: str = field(default_factory=lambda: os.environ.get("PARALLEL_API_KEY", ""))
    search_mode: SearchMode = field(
        default_factory=lambda: os.environ.get("PARALLEL_SEARCH_MODE", "turbo")  # type: ignore[return-value]
    )
    # Keep tool output small: the LLM reads all of it before it can start talking.
    max_chars_total: int = field(
        default_factory=lambda: int(os.environ.get("PARALLEL_MAX_CHARS", "4000"))
    )
    max_results: int = field(
        default_factory=lambda: int(os.environ.get("PARALLEL_MAX_RESULTS", "5"))
    )
    # Tells Parallel which model reads the results so it can tune excerpts.
    client_model: str | None = None


class ParallelAPI:
    def __init__(
        self, config: ParallelConfig | None = None, *, session_id: str | None = None
    ) -> None:
        self.config = config or ParallelConfig()
        if not self.config.api_key:
            raise RuntimeError(
                "PARALLEL_API_KEY is not set. Get one at https://platform.parallel.ai"
            )
        self.session_id = f"voice_{session_id or uuid.uuid4().hex}"
        self._client = AsyncParallel(api_key=self.config.api_key)

    async def aclose(self) -> None:
        await self._client.close()

    async def search(self, objective: str, search_queries: list[str]) -> str:
        queries = [q.strip() for q in search_queries if q.strip()]
        if not queries:
            raise ValueError("Supply at least one keyword query.")
        res = await self._client.search(
            objective=objective,
            search_queries=queries[:3],
            mode=self.config.search_mode,
            max_chars_total=self.config.max_chars_total,
            session_id=self.session_id,
            client_model=self.config.client_model,
            advanced_settings={"max_results": self.config.max_results},
        )
        if res.results:
            logger.info("Search · %s", res.results[0].url)
        else:
            logger.info("Search · no results")
        return _format_results(res.results) if res.results else "No results found."

    async def decide(self, entity: str, question: str) -> str:
        result = await self._client.post(
            "/v1/decisions",
            cast_to=object,
            body={
                "state": {"subject": entity},
                "questions": {"claim": {"type": "noul", "instructions": question}},
            },
        )
        answer = result["answers"]["claim"]
        sources = result.get("citations", [])
        source_url = sources[0]["url"] if sources else "no source returned"
        if answer["type"] == "refusal":
            logger.info("Decisions · declined to decide · %s", source_url)
            return (
                "No decision returned. Tell the caller the claim could not be verified."
            )
        logger.info(
            "Decisions · %.1f%% probability true · %s", answer["noul"] * 100, source_url
        )
        lines = [f"Estimated probability the claim is true: {answer['noul']:.1%}"]
        for source in result["citations"][: self.config.max_results]:
            lines.append(f"{source.get('title') or 'Source'} ({source['url']})")
            for excerpt in source.get("excerpts", [])[:1]:
                lines.append(excerpt[:600])
        return "\n".join(lines)


def _format_results(results) -> str:
    """Compact, LLM-friendly text: title, URL, date, then excerpts."""
    blocks = []
    for i, r in enumerate(results, 1):
        head = f"[{i}] {r.title or 'Untitled'} ({r.url})"
        if getattr(r, "publish_date", None):
            head += f" published {r.publish_date}"
        excerpts = "\n".join(r.excerpts or [])
        blocks.append(f"{head}\n{excerpts}".strip())
    return "\n\n".join(blocks)
