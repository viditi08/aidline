import { extractZip, isSanFranciscoZip } from "@/lib/sf";
import type { Category, SearchFocus, SearchInput, SessionContext, Urgency } from "@/lib/types";

export interface TurnPlan {
  context: SessionContext;
  reply: string;
  shouldSearch: boolean;
  searchInput: SearchInput | null;
}

const FOOD = /\b(food|hungry|grocer\w*|pantry|pantries|meal|meals|calfresh|snap|eat|eaten)\b/i;
const UTILITY = /\b(electric\w*|utility|utilities|pge|pg\s*&?\s*e|power|gas bill|shut\s?off|disconnect\w*|lights)\b/i;
const SENSITIVE =
  /\b\d{3}-\d{2}-\d{4}\b|\bsocial security\b|\bssn\b|\bcredit card\b|\bcard number\b|\bcvv\b|\bbank account\b|\brouting number\b/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

function quantity(value: string): number | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric)) return numeric;
  return NUMBER_WORDS[value.toLowerCase()] ?? null;
}

function detectCategory(text: string): Category | null {
  const food = FOOD.test(text);
  const utility = UTILITY.test(text);
  if (food && utility) {
    return /disconnect|shut\s?off|cut off|electric/i.test(text) ? "utility" : "food";
  }
  if (utility) return "utility";
  if (food) return "food";
  return null;
}

function detectUrgency(text: string, category: Category | null): Urgency | null {
  if (/open today|hours|are these|are they open/i.test(text)) return null;
  if (category === "utility" && /\b(disconnect\w*|shut\s?off|cut off|tomorrow)\b/i.test(text)) return "emergency";
  if (/\b(today|right now|tonight|this morning|haven'?t eaten)\b/i.test(text)) return "today";
  if (/\b(this week|few days|next few days|couple of days)\b/i.test(text)) return "soon";
  if (/\b(ongoing|monthly|calfresh|snap|grocery assistance|groceries)\b/i.test(text)) return "ongoing";
  return null;
}

function detectFocus(text: string): SearchFocus | null {
  if (/can'?t get there|delivery|deliver|ride|transport|without (going|a car)|come to me/i.test(text)) return "delivery";
  if (/qualif|eligib|do i qualify|am i eligible/i.test(text)) return "eligibility";
  if (/open today|what time|\bhours\b|are they open|are these/i.test(text)) return "hours";
  if (/how do i apply|application|sign up|enroll/i.test(text)) return "application";
  return null;
}

function detectProvider(text: string, category: Category | null): string | null {
  if (/pg\s*&?\s*e|pacific gas/i.test(text)) return "PG&E";
  if (/clean\s*power/i.test(text)) return "CleanPowerSF";
  if (category === "utility" && /\b(don'?t know|do not know|not sure|no idea|unsure)\b/i.test(text) && !/qualif|eligib/i.test(text)) {
    return "unknown";
  }
  return null;
}

function detectHousehold(text: string): number | null {
  const family = text.match(/\bfamily of\s+(\d+|one|two|three|four|five|six|seven|eight)\b/i);
  if (family) return quantity(family[1]);
  const household = text.match(/\bhousehold of\s+(\d+|one|two|three|four|five|six|seven|eight)\b/i);
  if (household) return quantity(household[1]);
  const kids = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s+kids?\b/i);
  if (kids) {
    const count = quantity(kids[1]);
    return count ? Math.min(12, count + 1) : null;
  }
  return null;
}

function ask(context: SessionContext, reply: string): TurnPlan {
  return { context, reply, shouldSearch: false, searchInput: null };
}

function ready(context: SessionContext, reply: string): TurnPlan {
  return {
    context,
    reply,
    shouldSearch: true,
    searchInput: {
      category: context.category as Category,
      zip_code: context.zip as string,
      urgency: context.urgency,
      household_size: context.householdSize,
      utility_provider: context.utilityProvider,
      focus: context.focus,
    },
  };
}

function foodAck(context: SessionContext): string {
  if (context.focus === "eligibility") {
    return "I can't decide whether you qualify. I'll look up what the official pages say about eligibility.";
  }
  if (context.focus === "hours") return "I'll check the sources for today's hours and I won't guess if they aren't listed.";
  if (context.focus === "delivery") return "I'll check whether any options mention delivery or another way to get food without going in person.";
  if (context.focus === "application") return "I'll look for the official page that explains how to apply.";
  if (context.urgency === "today") return "I'll search for options that may be able to help today.";
  if (context.urgency === "ongoing") return `I'll search for grocery and food assistance around ${context.zip}.`;
  return `I'll search for food assistance around ${context.zip}.`;
}

function utilityAck(context: SessionContext): string {
  if (context.urgency === "emergency" || context.urgency === "today") {
    return "Since a disconnection may be soon, contacting your utility is the first priority. I'll also look for assistance programs.";
  }
  if (context.focus === "eligibility") return "I can't decide whether you qualify. I'll look up what the official pages say.";
  return "I'll search for utility assistance programs and official contact information.";
}

export function nextTurn(context: SessionContext, raw: string): TurnPlan {
  const text = raw.trim().slice(0, 2000);
  const next: SessionContext = { ...context, resources: context.resources };

  if (SENSITIVE.test(text)) {
    return ask(
      next,
      "Please don't share Social Security numbers, bank details, or card numbers. I only need your situation and ZIP code.",
    );
  }

  const zip = extractZip(text);
  if (zip && !isSanFranciscoZip(zip)) {
    return ask(
      next,
      "AidLine currently covers San Francisco. If you have a San Francisco ZIP code, share it and I'll look. For help outside the city, 211 is a good place to start.",
    );
  }

  const category = detectCategory(text);
  if (category) next.category = category;
  if (/pg\s*&?\s*e|pacific gas|clean\s*power/i.test(text) && !next.category) next.category = "utility";

  const provider = detectProvider(text, next.category);
  if (provider) next.utilityProvider = provider;

  const urgency = detectUrgency(text, next.category);
  if (urgency) next.urgency = urgency;

  const household = detectHousehold(text);
  if (household) next.householdSize = household;

  const focus = detectFocus(text);
  if (focus) next.focus = focus;
  else if (category) next.focus = "general";

  if (zip) next.zip = zip;

  const followUp = next.focus === "hours" || next.focus === "delivery" || next.focus === "eligibility" || next.focus === "application";
  if (followUp && next.category && next.zip) {
    return ready(next, next.category === "utility" ? utilityAck(next) : foodAck(next));
  }
  if (followUp && (!next.category || !next.zip)) {
    if (!next.category) {
      return ask(next, "I can look that up once I know whether you need food or utility help, and your San Francisco ZIP code. Which do you need?");
    }
    return ask(next, "What San Francisco ZIP code should I use?");
  }

  if (!next.category) {
    return ask(next, "I can help with food assistance or a utility bill in San Francisco. Which one do you need?");
  }

  if (next.category === "utility") {
    if (!next.utilityProvider) {
      const urgent = next.urgency === "emergency" || next.urgency === "today";
      return ask(
        next,
        urgent
          ? "Since a disconnection may be soon, contact your utility first. Which company sends the bill? If you're not sure, say so."
          : "Which utility company sends the bill? If you're not sure, say so.",
      );
    }
    if (!next.zip) return ask(next, "What ZIP code are you in?");
    return ready(next, utilityAck(next));
  }

  if (!next.zip) return ask(next, "I can help you find food assistance. What ZIP code are you in?");
  if (!next.urgency && next.focus === "general") {
    return ask(next, "Is this something you need today, or are you looking for ongoing grocery assistance?");
  }
  return ready(next, foodAck(next));
}
