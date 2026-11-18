import { nextTurn } from "@/lib/dialogue";
import { sanitizeContext } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { message?: unknown; context?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "Say a bit more so I know how to help." }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json({ error: "That message is too long. Try a shorter description." }, { status: 400 });
  }

  const plan = nextTurn(sanitizeContext(body?.context), message);
  return Response.json(plan);
}
