import { AGENT_GREETING } from "@/lib/agent";
import { nextTurn } from "@/lib/dialogue";
import { smsResources, spokenResources } from "@/lib/phone-session";
import { searchAssistance } from "@/lib/search";
import { emptyContext, type Category, type SearchInput, type SessionContext } from "@/lib/types";

/** Twilio drops webhooks that take longer than 15 seconds, so keep searches well under that. */
export const PHONE_SEARCH_TIMEOUT_MS = 11000;

export const PHONE_GREETING = `${AGENT_GREETING} Please don't share Social Security, bank, or card numbers.`;
export const SMS_GREETING =
  "Hi, this is AidLine. I help find food or utility-bill assistance in San Francisco. Tell me what's going on and your ZIP code. Reply RESET to start over. Don't send SSN, bank, or card numbers.";

const GOODBYE = /^\s*(bye|goodbye|good bye|that'?s all|that is all|no thanks?|no thank you|i'?m done|hang up|end call)\b/i;
const TEXT_ME = /\b(text|sms|message)\s+(me|it|them|that|those)\b|\bsend (me )?(a |the )?(text|sms|message)\b/i;
const RESET = /^\s*(reset|start over|restart|new search)\s*$/i;

export function isGoodbye(text: string): boolean {
  return GOODBYE.test(text);
}

export function wantsText(text: string): boolean {
  return TEXT_ME.test(text);
}

export function isReset(text: string): boolean {
  return RESET.test(text);
}

export function searchInputFrom(context: SessionContext): SearchInput | null {
  if (!context.category || !context.zip) return null;
  return {
    category: context.category as Category,
    zip_code: context.zip,
    urgency: context.urgency,
    household_size: context.householdSize,
    utility_provider: context.utilityProvider,
    focus: context.focus,
  };
}

export interface PhoneSearchOutcome {
  context: SessionContext;
  spoken: string;
  text: string;
}

export async function runPhoneSearch(context: SessionContext): Promise<PhoneSearchOutcome | null> {
  const input = searchInputFrom(context);
  if (!input) return null;
  const result = await searchAssistance(input, { timeoutMs: PHONE_SEARCH_TIMEOUT_MS });
  const resources = result.resources.slice(0, 3);
  const next = { ...context, resources };
  const spoken = resources.length ? `${result.message} ${spokenResources(resources)}` : result.message;
  const text = resources.length ? `${result.message}\n\n${smsResources(resources)}` : result.message;
  return { context: next, spoken, text };
}

/** One SMS turn: returns the message bodies to send back, in order. */
export async function smsTurn(
  context: SessionContext,
  body: string,
): Promise<{ context: SessionContext; replies: string[] }> {
  const text = body.trim();
  if (!text || isReset(text)) return { context: emptyContext(), replies: [SMS_GREETING] };
  if (/^\s*(hi|hello|hey|help|start|info)\s*[.!?]?\s*$/i.test(text) && !context.category) {
    return { context, replies: [SMS_GREETING] };
  }

  const plan = nextTurn(context, text.slice(0, 2000));
  if (!plan.shouldSearch) return { context: plan.context, replies: [plan.reply] };

  const outcome = await runPhoneSearch(plan.context);
  if (!outcome) return { context: plan.context, replies: [plan.reply] };
  return {
    context: outcome.context,
    replies: [plan.reply, `${outcome.text}\n\nAsk "are they open today?" or "what if I can't get there?" for more.`],
  };
}
