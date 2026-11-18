import { extractZip, isSanFranciscoZip } from "@/lib/sf";
import type { Category, SearchFocus, SearchInput, SessionContext, Urgency } from "@/lib/types";

export interface TurnPlan {
  context: SessionContext;
  reply: string;
  shouldSearch: boolean;
  searchInput: SearchInput | null;
}

const FOOD =
  /\b(food|hungry|starving|grocer\w*|pantry|pantries|meal|meals|calfresh|snap|ebt|wic|eat|eaten|lunch|dinner|breakfast|restaurants?|soup kitchen|helpline|hotline)\b|can'?t afford (to eat|food|groceries)|nothing to eat|no food/i;
const OTHER_NEEDS = /\b(electric\w*|utility|utilities|pg\s*&?\s*e|power bill|gas bill|water bill|bills?|rent|evict\w*|shut\s?off|disconnect\w*|cut off)\b/i;
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
  return FOOD.test(text) ? "food" : null;
}

function detectUrgency(text: string): Urgency | null {
  if (/open today|hours|are these|are they open/i.test(text)) return null;
  if (/\b(today|right now|tonight|this morning|haven'?t eaten)\b/i.test(text)) return "today";
  if (/\b(this week|few days|next few days|couple of days)\b/i.test(text)) return "soon";
  if (/\b(ongoing|monthly|calfresh|snap|grocery assistance|groceries)\b/i.test(text)) return "ongoing";
  return null;
}

function detectFocus(text: string): SearchFocus | null {
  if (/help ?line|hot ?line|phone number|number (to|i can) call|who (can|do|should) i call|someone to (talk|call)|call someone/i.test(text)) return "helpline";
  if (/restaurants?|eat out|buy (a )?(hot )?meal|hot food with|use (my )?(ebt|calfresh) (for|at|to buy) (a )?(meal|food at)/i.test(text)) return "restaurants";
  if (/can'?t get there|delivery|deliver|ride|transport|without (going|a car)|come to me/i.test(text)) return "delivery";
  if (/qualif|eligib|do i qualify|am i eligible/i.test(text)) return "eligibility";
  if (/open today|what time|\bhours\b|are they open|are these/i.test(text)) return "hours";
  if (/how do i apply|application|sign up|enroll/i.test(text)) return "application";
  if (/\b(senior|seniors|older adult|elderly|over 6\d|disabilit\w*|disabled)\b/i.test(text)) return "seniors";
  if (/\b(wic|pregnant|baby|babies|infant|toddler|formula|school (meals?|lunch|breakfast))\b/i.test(text)) return "families";
  if (/free (hot )?meals?|hot meals?|soup kitchen|somewhere to eat|place to eat|something to eat|eat (today|tonight|now)|a meal/i.test(text)) return "meals";
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
      focus: context.focus,
    },
  };
}

function foodAck(context: SessionContext): string {
  if (context.focus === "helpline") return "I'll pull up food help numbers you can call.";
  if (context.focus === "meals") return `I'll look for free meals near ${context.zip}.`;
  if (context.focus === "restaurants") {
    return "I'll look up the CalFresh Restaurant Meals Program, which lets some people buy hot meals at restaurants with EBT.";
  }
  if (context.focus === "families") return "I'll look for food help for families with kids, like WIC and school meals.";
  if (context.focus === "seniors") return "I'll look for free meals and grocery help for older adults and people with disabilities.";
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
  if (!category && OTHER_NEEDS.test(text)) {
    return ask(
      next,
      "AidLine only helps with food. For bills, rent, or other needs, you can dial 2-1-1. If you also need food, tell me your ZIP code.",
    );
  }
  if (category) next.category = category;
  const urgency = detectUrgency(text);
  if (urgency) next.urgency = urgency;

  const household = detectHousehold(text);
  if (household) next.householdSize = household;

  const focus = detectFocus(text);
  if (focus) next.focus = focus;
  else if (category) next.focus = "general";

  if (zip) next.zip = zip;

  const foodFocus = next.focus === "meals" || next.focus === "restaurants" || next.focus === "helpline" || next.focus === "families" || next.focus === "seniors";
  if (foodFocus) next.category = "food";
  const followUp = next.focus === "hours" || next.focus === "delivery" || next.focus === "eligibility" || next.focus === "application";
  if (followUp && next.category && next.zip) {
    return ready(next, foodAck(next));
  }
  if (followUp && (!next.category || !next.zip)) {
    if (!next.category) {
      return ask(next, "I can look that up once I know your San Francisco ZIP code. What ZIP code are you in?");
    }
    return ask(next, "What San Francisco ZIP code should I use?");
  }

  if (!next.category) {
    if (/^\s*(hi|hello|hey|yo|good (morning|afternoon|evening))\b[\s!.,]*$/i.test(text)) {
      return ask(
        next,
        "Hi. I can help you find free meals, groceries, and food help lines in San Francisco. What ZIP code are you in?",
      );
    }
    next.category = "food";
  }

  if (!next.zip) {
    if (next.focus === "helpline") {
      return ask(next, "You can dial 2-1-1 any time for food help. What ZIP code are you in, so I can also find places near you?");
    }
    return ask(next, "I can help you find free food. What ZIP code are you in?");
  }
  if (foodFocus) return ready(next, foodAck(next));
  if (!next.urgency && next.focus === "general") {
    return ask(next, "Is this something you need today, or are you looking for ongoing grocery assistance?");
  }
  return ready(next, foodAck(next));
}
