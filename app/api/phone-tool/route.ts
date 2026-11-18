import { PHONE_SECRET_HEADER, phoneToolResult, secretMatches } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// AssemblyAI calls this during phone calls: the body is the search_assistance arguments.
export async function POST(request: Request) {
  const secret = process.env.PHONE_TOOL_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "PHONE_TOOL_SECRET is not set." }, { status: 503 });
  }
  if (!secretMatches(secret, request.headers.get(PHONE_SECRET_HEADER))) {
    return Response.json({ error: "Invalid secret." }, { status: 401 });
  }
  const args = await request.json().catch(() => ({}));
  try {
    return new Response(await phoneToolResult(args), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Phone tool error", error instanceof Error ? error.message : error);
    return Response.json({ speak_this: "I couldn't search just now. You can dial 2-1-1 for food help." });
  }
}
