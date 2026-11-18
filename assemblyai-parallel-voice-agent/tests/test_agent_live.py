"""Live text turns through AssemblyAI and the hosted Parallel MCP server."""

import os

import pytest
from dotenv import load_dotenv
from livekit.agents import AgentSession

load_dotenv(".env.local")

pytestmark = pytest.mark.skipif(
    not os.environ.get("ASSEMBLYAI_API_KEY"),
    reason="needs ASSEMBLYAI_API_KEY",
)


async def test_voice_tools_in_one_conversation():
    import agent

    turns = [
        ("What's new in the latest stable Python release?", "web_search"),
        (
            "Read https://docs.python.org/3/howto/free-threading-python.html "
            "and tell me how that page checks whether the GIL is enabled.",
            "web_fetch",
        ),
        (
            "How likely is it that NumPy 2.1 officially supports Python 3.13? "
            "Give a probability.",
            "web_decisions",
        ),
    ]
    async with AgentSession() as session:
        await session.start(agent.SearchAssistant())
        greeting = await session.run(user_input="Hi there, how are you?")
        assert all(event.type != "function_call" for event in greeting.events)
        for question, tool in turns:
            result = await session.run(user_input=question)
            result.expect.contains_function_call(name=tool)
            outputs = [
                event.item
                for event in result.events
                if event.type == "function_call_output" and event.item.name == tool
            ]
            assert any(
                not item.is_error and "https://" in (item.output or "")
                for item in outputs
            ), f"{tool} returned no sourced evidence"
            assert (
                result.expect.contains_message(role="assistant")
                .event()
                .item.text_content
            )
