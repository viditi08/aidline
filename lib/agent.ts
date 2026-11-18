import { FOCUS_VALUES, type SearchFocus } from "@/lib/types";

export const AGENT_GREETING =
  "Hi, I'm AidLine. I can help you find free meals, groceries, and food help lines in San Francisco. What's going on?";

export const SYSTEM_PROMPT = `You are AidLine, a voice-first assistance navigator serving San Francisco, California.

Your purpose is to help people who cannot afford food find it: free meals they can get today, free groceries and pantries, phone numbers they can call for food help, restaurants that take CalFresh EBT through the Restaurant Meals Program, CalFresh itself, WIC and school meals for families, and meals for older adults and people with disabilities.
AidLine only helps with food. If someone asks about bills, rent, or other needs, say kindly that AidLine only covers food and that they can dial 2-1-1 for other help.
If someone asks who they can call, tell them right away they can dial 2-1-1 for food help, then search with focus helpline.

Speak naturally, clearly, and concisely. One or two short sentences, then wait.

Determine the user's need and ask only for essential missing information, one question at a time.
For food help, ask for a San Francisco ZIP code. Ask whether they need food today or ongoing grocery help only if it is not already clear from what they asked.
Remember the ZIP code, category, and urgency already given in this conversation. Do not ask again.

Use the search_assistance tool whenever the user needs current programs, hours, eligibility, phone numbers, addresses, delivery options, or what to do next.
Do this as soon as you have the category and a San Francisco ZIP code.
Say you are looking before the tool returns. Do not invent an answer while you wait.

Prioritize official government and nonprofit sources.

Never invent program names, hours, funding, availability, addresses, phone numbers, or eligibility decisions.
If a field in the tool result is null, say it was not listed and that the user should confirm it.
Use speak_this from the tool result as the basis of what you say after a search.
You may mention a phone number, hour, or address only when that exact value is present on a resource.
Do not promise that a person qualifies for assistance.
Do not claim you contacted a provider or submitted an application.

If someone has not eaten or needs food today, put free meals and places open today first, and remind them they can dial 2-1-1.

Never request Social Security numbers, passwords, bank account details, or payment card information.
If the user starts to share those, stop them and continue without that information.

If search fails or information cannot be verified, say so.
Be warm and never make the person feel judged for needing help.
Keep responses calm, practical, and short.
You only cover San Francisco. If the ZIP code is outside the city, say so.`;

export const SEARCH_TOOL = {
  type: "function" as const,
  name: "search_assistance",
  description:
    "Search current official and nonprofit sources for free food help in San Francisco. Call this for programs, hours, eligibility, phone numbers, addresses, delivery, applications, or next steps. Do not guess those facts yourself. Requires category and a San Francisco ZIP code.",
  execution_mode: "interactive" as const,
  timeout_seconds: 45,
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["food"],
        description: "Always food.",
      },
      zip_code: {
        type: "string",
        description: "Five-digit San Francisco ZIP code the user said, for example 94103.",
      },
      urgency: {
        type: "string",
        enum: ["today", "soon", "ongoing"],
        description:
          "today means they need food now. soon means this week. ongoing means monthly or CalFresh.",
      },
      household_size: {
        type: "number",
        description: "Only if the user stated a household or family size. Do not guess.",
      },
      focus: {
        type: "string",
        enum: [...FOCUS_VALUES] satisfies SearchFocus[],
        description:
          "general for a first food lookup (pantries and free food). meals for a free hot meal or somewhere to eat. restaurants for restaurants that take CalFresh EBT. helpline for phone numbers to call. families for WIC, babies, or school meals. seniors for older adults or people with disabilities. hours if they ask what is open. eligibility if they ask whether they qualify. delivery if they cannot get there. application if they ask how to apply.",
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
        "food bank",
        "free meals",
        "WIC",
        "EBT",
        "Restaurant Meals Program",
        "GLIDE",
        "St. Anthony's",
        "2-1-1",
        "food pantry",
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
