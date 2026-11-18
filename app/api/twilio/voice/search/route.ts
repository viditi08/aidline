import { loadSession, saveSession } from "@/lib/phone-session";
import { runPhoneSearch } from "@/lib/phone-agent";
import { gather, hangup, readTwilioWebhook, say, twimlResponse, webhookPath } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

// Reached by <Redirect> after the agent says it is searching.
export async function POST(request: Request) {
  const webhook = await readTwilioWebhook(request);
  if (webhook instanceof Response) return webhook;
  const { params, config } = webhook;

  const sessionId = `call:${params.CallSid ?? ""}`;
  const turnUrl = webhookPath(request, "/api/twilio/voice/turn");
  const goodbye = say("Thanks for calling AidLine. Take care.") + hangup();

  const outcome = await runPhoneSearch(loadSession(sessionId));
  if (!outcome) {
    return twimlResponse(gather("I need your San Francisco ZIP code and whether you need food or utility help.", turnUrl) + goodbye);
  }
  saveSession(sessionId, outcome.context);

  const canText = Boolean(config?.phoneNumber) && outcome.context.resources.length > 0;
  const followUp = canText
    ? 'You can ask if they are open today, or say "text me" and I\'ll send these to this phone.'
    : "You can ask if they are open today, or what to do if you can't get there.";

  return twimlResponse(
    say(outcome.spoken) + gather(followUp, turnUrl, 8) + goodbye,
  );
}
