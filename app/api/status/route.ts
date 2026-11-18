import { freeSearchEnabled } from "@/lib/parallel-mcp";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    voice: Boolean(process.env.ASSEMBLYAI_API_KEY?.trim()),
    search: Boolean(process.env.PARALLEL_API_KEY?.trim()) || freeSearchEnabled(),
  });
}
