import type { SearchFocus } from "@/lib/types";

export const AGENT_GREETING =
  "Hi, I'm AidLine. I can help you find food or utility assistance in San Francisco. What's going on?";

export const SYSTEM_PROMPT = `You are AidLine, a voice-first assistance navigator serving San Francisco, California.

Your purpose is to help users discover food assistance and emergency utility-bill assistance.

Speak naturally, clearly, and concisely. One or two short sentences, then wait.

Determine the user's need and ask only for essential missing information, one question at a time.
For food help, ask for a San Francisco ZIP code, then whether they need food today or ongoing grocery assistance, unless they already said.
For a utility bill, ask which company sends the bill, then the ZIP code, unless they already said.
Remember the ZIP code, category, and urgency already given in this conversation. Do not ask again.

Use the search_assistance tool whenever the user needs current programs, hours, eligibility, phone numbers, addresses, delivery options, or what to do next.
Do this as soon as you have the category and a San Francisco ZIP code.
Say you are looking before the tool returns. Do not invent an answer while you wait.

Prioritize official government, utility, and nonprofit sources.

Never invent program names, hours, funding, availability, addresses, phone numbers, or eligibility decisions.
If a field in the tool result is null, say it was not listed and that the user should confirm it.
Use speak_this from the tool result as the basis of what you say after a search.
You may mention a phone number, hour, or address only when that exact value is present on a resource.
Do not promise that a person qualifies for assistance.
Do not claim you contacted a provider or submitted an application.

If the situation is urgent, especially a possible utility disconnection, the first priority is contacting the utility provider directly. Then share programs the search returned.

Never request Social Security numbers, passwords, bank account details, or payment card information.
If the user starts to share those, stop them and continue without that information.

If search fails or information cannot be verified, say so.
Keep responses calm, practical, and short.
You only cover San Francisco. If the ZIP code is outside the city, say so.`;

export const SEARCH_TOOL = {
  type: "function" as const,
  name: "search_assistance",
  description:
    "Search current official and nonprofit sources for food or utility assistance in San Francisco. Call this for programs, hours, eligibility, phone numbers, addresses, delivery, applications, or next steps. Do not guess those facts yourself. Requires category and a San Francisco ZIP code.",
  execution_mode: "interactive" as const,
  timeout_seconds: 45,
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["food", "utility"],
        description: "food for groceries, pantries, or CalFresh. utility for an electric or gas bill, shutoff, or payment help.",
      },
      zip_code: {
        type: "string",
        description: "Five-digit San Francisco ZIP code the user said, for example 94103.",
      },
      urgency: {
        type: "string",
        enum: ["today", "soon", "ongoing", "emergency"],
        description:
          "today means they need food now. soon means this week. ongoing means monthly or CalFresh. emergency means a utility shutoff is imminent.",
      },
      household_size: {
        type: "number",
        description: "Only if the user stated a household or family size. Do not guess.",
      },
      utility_provider: {
        type: "string",
        description: "Utility company the user named, such as PG&E. Use unknown if they are not sure.",
      },
      focus: {
        type: "string",
        enum: ["general", "hours", "eligibility", "delivery", "application"] satisfies SearchFocus[],
        description:
          "general for a first lookup. hours if they ask what is open. eligibility if they ask whether they qualify. delivery if they cannot get there. application if they ask how to apply.",
      },
    },
    required: ["category", "zip_code"],
  },
};

export function voiceSessionConfig(seeded: boolean) {
  return {
    system_prompt: SYSTEM_PROMPT,
    ...(seeded ? {} : { greeting: AGENT_GREETING }),
    tools: [SEARCH_TOOL],
    input: {
      format: { encoding: "audio/pcm" },
      keyterms: [
        "AidLine",
        "San Francisco",
        "CalFresh",
        "PG&E",
        "LIHEAP",
        "food bank",
        "food pantry",
        "utility",
        "disconnection",
        "94103",
        "94110",
        "94102",
      ],
      transcription_mode: "balanced",
      language_codes: ["en"],
      voice_focus: "near-field",
      turn_detection: {
        vad_threshold: 0.5,
        min_silence: 700,
        max_silence: 2500,
        interrupt_response: true,
        interruption_delay: 120,
      },
    },
    output: {
      voice: "alba",
      format: { encoding: "audio/pcm" },
      volume: 100,
    },
  };
}
