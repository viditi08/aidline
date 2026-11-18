import { clearSession } from "@/lib/phone-session";
import { PHONE_GREETING } from "@/lib/phone-agent";
import { gather, hangup, readTwilioWebhook, say, twimlResponse, webhookPath } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Twilio "A call comes in" webhook.
export async function POST(request: Request) {
  const webhook = await readTwilioWebhook(request);
  if (webhook instanceof Response) return webhook;
  const callSid = webhook.params.CallSid;
  if (callSid) clearSession(`call:${callSid}`);

  return twimlResponse(
    gather(PHONE_GREETING, webhookPath(request, "/api/twilio/voice/turn")) +
      say("I didn't hear anything. Call back any time. Goodbye.") +
      hangup(),
  );
}
