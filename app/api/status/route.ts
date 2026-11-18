export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    voice: Boolean(process.env.ASSEMBLYAI_API_KEY?.trim()),
    search: Boolean(process.env.PARALLEL_API_KEY?.trim()),
    phone: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim()),
  });
}
