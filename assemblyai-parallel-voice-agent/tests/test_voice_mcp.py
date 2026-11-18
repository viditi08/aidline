import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from livekit.agents import RunContext, function_tool

from voice_mcp import with_spoken_acknowledgment


@pytest.mark.parametrize("slow", [False, True])
async def test_acknowledgment_only_during_slow_lookup(slow):
    spoken = asyncio.Event()
    session = Mock(wait_for_idle=AsyncMock())
    session.say.side_effect = lambda *args, **kwargs: spoken.set()

    async def wait_for_tasks(tasks):
        await asyncio.gather(*tasks)

    ctx = RunContext(
        session=session,
        speech_handle=SimpleNamespace(
            num_steps=1, wait_if_not_interrupted=wait_for_tasks
        ),
        function_call=Mock(),
    )
    schema = {"name": "web_search", "parameters": {"type": "object"}}

    @function_tool(raw_schema=schema)
    async def lookup(raw_arguments):
        if slow:
            await asyncio.wait_for(spoken.wait(), timeout=4)
        return raw_arguments

    tool = with_spoken_acknowledgment(lookup)
    assert tool.info.raw_schema == lookup.info.raw_schema
    assert await tool(ctx, {"query": "Python"}) == {"query": "Python"}
    if slow:
        session.say.assert_called_once_with(
            "Searching trusted assistance resources.",
            add_to_chat_ctx=False,
            allow_interruptions=True,
        )
    else:
        session.say.assert_not_called()
