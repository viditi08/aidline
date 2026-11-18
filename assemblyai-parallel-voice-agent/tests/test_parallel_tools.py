import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from parallel_api import ParallelAPI, ParallelConfig, _format_results


def test_format_results():
    results = [
        SimpleNamespace(
            title="Hello",
            url="https://a.com",
            publish_date="2026-01-02",
            excerpts=["one", "two"],
        ),
        SimpleNamespace(
            title=None, url="https://b.com", publish_date=None, excerpts=[]
        ),
    ]
    out = _format_results(results)
    assert "[1] Hello (https://a.com) published 2026-01-02\none\ntwo" in out
    assert "[2] Untitled (https://b.com)" in out


def test_missing_key_raises():
    with pytest.raises(RuntimeError):
        ParallelAPI(ParallelConfig(api_key=""))


live = pytest.mark.skipif(
    not os.environ.get("PARALLEL_API_KEY"), reason="PARALLEL_API_KEY not set"
)


@live
async def test_live_search():
    tools = ParallelAPI()
    try:
        out = await tools.search(
            "Find the official website of the LiveKit Agents framework.",
            ["LiveKit Agents framework", "LiveKit voice agents"],
        )
    finally:
        await tools.aclose()
    assert "livekit" in out.lower()


async def test_decision_refusal(monkeypatch):
    tools = ParallelAPI(ParallelConfig(api_key="test"))
    post = AsyncMock(return_value={"answers": {"claim": {"type": "refusal"}}})
    monkeypatch.setattr(tools._client, "post", post)
    try:
        assert "could not be verified" in await tools.decide("Python", "Is it free?")
    finally:
        await tools.aclose()
    assert post.await_args.args == ("/v1/decisions",)
    assert post.await_args.kwargs["body"]["questions"]["claim"]["type"] == "noul"
