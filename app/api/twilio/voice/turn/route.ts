import { nextTurn } from "@/lib/dialogue";
import { clearSession, loadSession, saveSession, smsResources } from "@/lib/phone-session";
import { isGoodbye, wantsText } from "@/lib/phone-agent";
import { gather, hangup, readTwilioWebhook, say, sendSms, twimlResponse, webhookPath } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Gather action: Twilio posts the caller's transcribed speech as SpeechResult.
export async function POST(request: Request) {
  const webhook = await readTwilioWebhook(request);
  if (webhook instanceof Response) return webhook;
  const { params, config } = webhook;

  const callSid = params.CallSid ?? "";
  const sessionId = `call:${callSid}`;
  const speech = (params.SpeechResult ?? "").trim();
  const turnUrl = webhookPath(request, "/api/twilio/voice/turn");
  const goodbye = say("Thanks for calling AidLine. Take care.") + hangup();

  if (!callSid) return twimlResponse(goodbye);

  if (!speech) {
    return twimlResponse(gather("Sorry, I didn't catch that. What do you need help with?", turnUrl) + goodbye);
  }

  if (isGoodbye(speech)) {
    clearSession(sessionId);
    return twimlResponse(goodbye);
  }

  const context = loadSession(sessionId);

  if (wantsText(speech)) {
    if (!context.resources.length) {
      return twimlResponse(gather("I don't have any options to send yet. What do you need help with?", turnUrl) + goodbye);
    }
    const to = params.From;
    const error = config && to ? await sendSms(config, to, `AidLine options:\n\n${smsResources(context.resources)}`) : "unavailable";
    const reply = error
      ? "Sorry, I couldn't send a text right now. You can find these on the AidLine website."
      : "I sent those options to this phone number by text.";
    return twimlResponse(gather(`${reply} Is there anything else?`, turnUrl) + goodbye);
  }

  const plan = nextTurn(context, speech);
  saveSession(sessionId, plan.context);

  if (plan.shouldSearch) {
    return twimlResponse(
      say(`${plan.reply} Searching trusted assistance resources. This can take a few seconds.`) +
        `<Redirect method="POST">${webhookPath(request, "/api/twilio/voice/search")}</Redirect>`,
    );
  }

  return twimlResponse(gather(plan.reply, turnUrl) + goodbye);
}
