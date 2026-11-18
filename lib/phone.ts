import { timingSafeEqual } from "node:crypto";
import { AGENT_GREETING, SEARCH_TOOL, SYSTEM_PROMPT } from "@/lib/agent";
import { percent } from "@/lib/decision-labels";
import { searchAssistance } from "@/lib/search";
import type { SearchResponse } from "@/lib/types";
import { parseSearchInput } from "@/lib/validate";

/**
 * Phone calls: Twilio number → SIP trunk → AssemblyAI Voice Agent.
 * The agent's search_assistance tool is an HTTP tool: AssemblyAI POSTs the tool
 * arguments to /api/phone-tool, and this app runs Parallel Search + Decisions.
 * https://www.assemblyai.com/docs/voice-agents/voice-agent-api/twilio-own-number
 */

/** Keep search + Decisions well inside the tool timeout we give AssemblyAI. */
export const PHONE_SEARCH_TIMEOUT_MS = 10000;
export const PHONE_DECISION_TIMEOUT_MS = 8000;
export const PHONE_TOOL_TIMEOUT_SECONDS = 30;
export const PHONE_SECRET_HEADER = "x-aidline-secret";

export const PHONE_PROMPT_ADDITIONS = `
You are on a phone call. Keep every turn to one or two short sentences.
Always set category to "food" when you call search_assistance.
The search_assistance result has speak_this (what to say) and details (phone numbers, addresses, and Parallel Decisions estimates). Base your reply on speak_this, and use details for specifics.
Describe Parallel Decisions estimates as "likely" or "probably", never as certain and never as a decision about whether the caller qualifies.
Say phone numbers slowly, in groups, for example "four one five, two eight two, one nine zero zero". Offer to repeat a phone number.
Never read out web addresses; say "the city's free food page" or the organization's name instead.
If the tool returns an error or times out, say you couldn't search just now and suggest dialing 2-1-1.`;

export function secretMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected) return true;
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One flat line keeps the tool result small and easy for the voice model to read. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What the caller should hear, built only from fields present on each resource. */
export function phoneSummary(result: SearchResponse): string {
  const details = result.resources.slice(0, 3).map((resource, index) => {
    const facts = [`Option ${index + 1}: ${resource.name}.`];
    if (resource.phone) facts.push(`Listed phone: ${resource.phone}.`);
    if (resource.address) facts.push(`Listed address: ${resource.address}.`);
    if (resource.hours) facts.push(`Listed hours: ${resource.hours}.`);
    const decision = resource.decision;
    if (decision?.open_today != null) facts.push(`Parallel Decisions estimate, serving food ${decision.day}: ${percent(decision.open_today)}.`);
    if (decision?.audience === "anyone") facts.push("Estimate: open to anyone.");
    if (decision?.audience === "specific_group") facts.push("Estimate: for a specific group.");
    if (decision?.audience === "application_required") facts.push("Estimate: apply first.");
    facts.push(`Next step: ${resource.action}`);
    return facts.join(" ");
  });
  return oneLine(
    JSON.stringify({
      speak_this: result.message,
      details: details.join(" "),
      rules:
        "Mention a phone, address, or hour only if it appears in details. Estimates are not guarantees or eligibility decisions. Read phone numbers slowly.",
    }),
  );
}

/** Runs search_assistance for a phone call and returns the text the agent reads. */
export async function phoneToolResult(args: unknown): Promise<string> {
  const record = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const parsed = parseSearchInput({ ...record, category: "food" });
  if ("error" in parsed) {
    return parsed.error.includes("San Francisco")
      ? oneLine(JSON.stringify({ speak_this: "AidLine only covers San Francisco. If you have a San Francisco ZIP code, tell me and I'll look. You can also dial 2-1-1." }))
      : oneLine(JSON.stringify({ speak_this: "What San Francisco ZIP code are you in?", missing: parsed.error }));
  }
  const result = await searchAssistance(parsed, {
    timeoutMs: PHONE_SEARCH_TIMEOUT_MS,
    decisionTimeoutMs: PHONE_DECISION_TIMEOUT_MS,
  });
  return phoneSummary(result);
}

/** AssemblyAI Voice Agent definition for the phone line. */
export function phoneAgentConfig(toolUrl: string, secret: string) {
  return {
    name: "AidLine phone",
    system_prompt: `${SYSTEM_PROMPT}\n${PHONE_PROMPT_ADDITIONS}`,
    greeting: AGENT_GREETING,
    voice: { voice_id: "alba" },
    tools: [
      {
        name: SEARCH_TOOL.name,
        description: SEARCH_TOOL.description,
        parameters: SEARCH_TOOL.parameters,
        execution_mode: "interactive",
        timeout_seconds: PHONE_TOOL_TIMEOUT_SECONDS,
        http: {
          url: toolUrl,
          http_method: "POST",
          headers: [{ name: PHONE_SECRET_HEADER, value: secret }],
        },
      },
    ],
    input: {
      keyterms: [
        "AidLine",
        "San Francisco",
        "CalFresh",
        "EBT",
        "WIC",
        "food bank",
        "food pantry",
        "free meals",
        "Restaurant Meals Program",
        "GLIDE",
        "St. Anthony's",
        "2-1-1",
        "94102",
        "94103",
        "94110",
        "94112",
        "94124",
      ],
      transcription_mode: "balanced",
      language_codes: ["en"],
      turn_detection: {
        min_silence: 700,
        max_silence: 2500,
        interrupt_response: true,
        interruption_delay: 120,
      },
    },
  };
}
