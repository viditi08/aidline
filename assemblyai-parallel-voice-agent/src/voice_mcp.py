"""Acknowledge slow web lookups while keeping Parallel's hosted tool schemas."""

from typing import Any

from livekit.agents import RunContext, function_tool, mcp


def with_spoken_acknowledgment(tool: mcp.MCPTool) -> mcp.MCPTool:
    @function_tool(raw_schema=tool.info.raw_schema)
    async def call(ctx: RunContext, raw_arguments: dict[str, Any]) -> Any:
        def acknowledge(step: int):
            return ctx.session.say(
                "Searching trusted assistance resources.",
                add_to_chat_ctx=False,
                allow_interruptions=True,
            )

        async with ctx.with_filler(acknowledge, delay=1.0):
            return await tool(raw_arguments)

    return call


class VoiceMCPServer(mcp.MCPServerHTTP):
    async def list_tools(self, *, tool_options=None):
        tools = await super().list_tools(tool_options=tool_options)
        return [with_spoken_acknowledgment(tool) for tool in tools]
