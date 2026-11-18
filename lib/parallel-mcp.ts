import type { ParallelHit } from "@/lib/search";

/**
 * Parallel's hosted MCP server. It works without an API key (free, rate-limited),
 * so AidLine can run live searches before anyone signs up for Parallel.
 * https://docs.parallel.ai/integrations/mcp/quickstart
 */
const MCP_URL = "https://mcp.parallel.ai/mcp";
const PROTOCOL = "2025-03-26";

export function freeSearchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PARALLEL_FREE_SEARCH ?? "").trim().toLowerCase() !== "off";
}

interface RpcMessage {
  id?: number;
  result?: {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  error?: { message?: string };
}

/** Responses arrive as JSON or as a server-sent event stream; read either. */
export function parseRpcBody(body: string): RpcMessage[] {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return [JSON.parse(trimmed) as RpcMessage];
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as RpcMessage);
}

export function hitsFromToolResult(message: RpcMessage | undefined): ParallelHit[] {
  const result = structuredResult(message, "web_search") as { results?: ParallelHit[] } | null;
  return Array.isArray(result?.results) ? result.results : [];
}

interface ToolCallResult {
  isError?: boolean;
  structuredContent?: unknown;
  content?: { type: string; text?: string }[];
}

/** Opens a session on Parallel's MCP server and calls one tool. Returns the tool's structured result. */
export async function mcpCallTool(
  name: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number; apiKey?: string } = {},
): Promise<unknown> {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 20000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL,
  };
  if (options.apiKey) headers["x-api-key"] = options.apiKey;

  const init = await fetch(MCP_URL, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "aidline", version: "0.1.0" } },
    }),
  });
  if (!init.ok) throw new Error(`Parallel MCP initialize failed (${init.status}).`);
  await init.text();
  const sessionId = init.headers.get("mcp-session-id");
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const ready = await fetch(MCP_URL, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  await ready.text();

  const call = await fetch(MCP_URL, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await call.text();
  if (!call.ok) throw new Error(`Parallel MCP ${name} failed (${call.status}): ${body.slice(0, 200)}`);
  return structuredResult(parseRpcBody(body).find((message) => message.id === 2), name);
}

export function structuredResult(message: RpcMessage | undefined, name = "tool"): unknown {
  if (!message) throw new Error(`Parallel MCP returned no response for ${name}.`);
  if (message.error) throw new Error(message.error.message ?? "Parallel MCP error.");
  const result = message.result as ToolCallResult | undefined;
  if (!result || result.isError) {
    const text = result?.content?.find((item) => item.type === "text")?.text ?? "unknown error";
    throw new Error(`Parallel MCP ${name} failed: ${text.slice(0, 200)}`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}

export async function mcpWebSearch(
  request: { objective: string; search_queries: string[] },
  options: { timeoutMs?: number; apiKey?: string } = {},
): Promise<ParallelHit[]> {
  const result = (await mcpCallTool(
    "web_search",
    { objective: request.objective, search_queries: request.search_queries },
    options,
  )) as { results?: ParallelHit[] } | null;
  return Array.isArray(result?.results) ? result.results : [];
}
