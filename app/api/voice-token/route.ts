import { voiceSessionConfig } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: "Voice is not configured. Add ASSEMBLYAI_API_KEY to .env.local and restart." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { seeded?: boolean };
  const tokenResponse = await fetch("https://token.assemblyai.com/v1/token", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      product: "speech_to_speech",
      expires_in_seconds: 300,
      max_session_duration_seconds: 3600,
    }),
  });

  if (!tokenResponse.ok) {
    const detail = await tokenResponse.text();
    console.error(`AssemblyAI token failed (${tokenResponse.status}): ${detail.slice(0, 300)}`);
    return Response.json({ error: "AidLine could not start a voice session." }, { status: 502 });
  }

  const payload = (await tokenResponse.json()) as { token?: string };
  if (!payload.token) {
    return Response.json({ error: "AidLine could not start a voice session." }, { status: 502 });
  }

  return Response.json({
    token: payload.token,
    session: voiceSessionConfig(Boolean(body.seeded)),
  });
}
