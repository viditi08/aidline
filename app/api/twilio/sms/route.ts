import { loadSession, saveSession, clearSession } from "@/lib/phone-session";
import { isReset, smsTurn } from "@/lib/phone-agent";
import { escapeXml, readTwilioWebhook, twimlResponse } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

// Twilio "A message comes in" webhook. Replies with TwiML <Message> elements.
export async function POST(request: Request) {
  const webhook = await readTwilioWebhook(request);
  if (webhook instanceof Response) return webhook;
  const { params } = webhook;

  const from = params.From ?? "";
  const body = params.Body ?? "";
  if (!from) return twimlResponse("");

  if (isReset(body)) clearSession(`sms:${from}`);
  const { context, replies } = await smsTurn(loadSession(`sms:${from}`), body);
  saveSession(`sms:${from}`, context);

  return twimlResponse(replies.map((reply) => `<Message>${escapeXml(reply)}</Message>`).join(""));
}
