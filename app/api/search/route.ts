import { searchAssistance, toolResultForAgent } from "@/lib/search";
import { parseSearchInput } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseSearchInput(body);
  if ("error" in parsed) {
    const outside = parsed.error.includes("San Francisco");
    return Response.json(
      {
        error: parsed.error,
        message: outside
          ? "AidLine currently covers San Francisco. If you have a San Francisco ZIP code, share it and I can look."
          : parsed.error,
        search_status: outside ? "outside_area" : "unavailable",
        resources: [],
      },
      { status: 400 },
    );
  }

  const result = await searchAssistance(parsed);
  return Response.json({ ...result, tool_result: toolResultForAgent(result) });
}
