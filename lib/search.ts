import { addressCount, clip, cleanTitle, extractAddress, extractDocuments, extractEligibility, extractHours, extractPhone } from "@/lib/extract";
import { decideResources, spokenDecision } from "@/lib/decisions";
import { freeSearchEnabled, mcpWebSearch } from "@/lib/parallel-mcp";
import { isSanFranciscoZip } from "@/lib/sf";
import type { Category, Resource, SearchFocus, SearchInput, SearchResponse, SearchStatus, Urgency } from "@/lib/types";

const OFFICIAL_DOMAINS = [
  "sfmfoodbank.org",
  "sfhsa.org",
  "sf.gov",
  "sfgov.org",
  "getcalfresh.org",
  "cdss.ca.gov",
  "benefitscal.com",
  "ca.gov",
  "211bayarea.org",
  "glide.org",
  "stanthonysf.org",
  "sfusd.edu",
];

const STATEWIDE_DOMAINS = ["ca.gov", "getcalfresh.org", "benefitscal.com", "cdss.ca.gov"];

const EXCLUDED_DOMAINS = [
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "yelp.com",
  "wikipedia.org",
];

const OTHER_PLACE = /\b(oakland|san jose|los angeles|sacramento|fresno|san diego|berkeley|daly city)\b/i;
const SAN_FRANCISCO = /\b(san francisco|\bsf\b)\b/i;
const FOOD_RELEVANT = /\b(food|pantry|calfresh|snap|meal|meals|grocery|groceries|hunger|nutrition|wic|restaurant|restaurants|kitchen|dining)\b/i;

export interface ParallelHit {
  url: string;
  title?: string | null;
  publish_date?: string | null;
  excerpts?: string[];
}

interface ParallelRequest {
  objective: string;
  search_queries: string[];
  mode: "fast";
  max_chars_total: number;
  advanced_settings: {
    location: "us";
    max_results: number;
    source_policy: { exclude_domains: string[] };
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isOfficialHost(host: string): boolean {
  return OFFICIAL_DOMAINS.some((domain) => matchesDomain(host, domain));
}

function isStatewide(host: string): boolean {
  return STATEWIDE_DOMAINS.some((domain) => matchesDomain(host, domain));
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function query(value: string): string {
  const count = wordCount(value);
  if (count < 3 || count > 6) {
    throw new Error(`Search query must be 3 to 6 words: "${value}" (${count})`);
  }
  return value;
}

function foodQueries(input: SearchInput): string[] {
  const zip = input.zip_code;
  const focus = input.focus ?? "general";
  if (focus === "hours") {
    return [query(`San Francisco pantry hours ${zip}`), query("San Francisco food pantry today"), query("SF-Marin Food Bank schedule")];
  }
  if (focus === "eligibility") {
    return [query("CalFresh eligibility California"), query("San Francisco food assistance eligibility"), query("SF Human Services food")];
  }
  if (focus === "delivery") {
    return [query("San Francisco food delivery assistance"), query("SF-Marin Food Bank delivery"), query("home delivered meals San Francisco")];
  }
  if (focus === "application") {
    return [query("apply CalFresh San Francisco"), query("BenefitsCal food assistance"), query("SF HSA food programs")];
  }
  if (focus === "meals") {
    return [query("free hot meals San Francisco"), query(`free meals near ${zip} San Francisco`), query("San Francisco community meals today")];
  }
  if (focus === "restaurants") {
    return [query("Restaurant Meals Program San Francisco"), query("CalFresh EBT restaurants San Francisco"), query("California Restaurant Meals Program")];
  }
  if (focus === "helpline") {
    return [query("San Francisco free food phone"), query("SF-Marin Food Bank contact"), query("CalFresh San Francisco phone number")];
  }
  if (focus === "families") {
    return [query("WIC San Francisco apply"), query("free school meals San Francisco"), query("food help families San Francisco")];
  }
  if (focus === "seniors") {
    return [query("free meals older adults San Francisco"), query("home delivered meals San Francisco"), query("SF DAS community meals")];
  }
  if (input.urgency === "today") {
    return [query(`free meals near ${zip} today`), query("free food locations San Francisco"), query("San Francisco food pantry today")];
  }
  return [query(`San Francisco food pantry ${zip}`), query("free food locations San Francisco"), query("SF-Marin Food Bank pantry")];
}

export function buildSearchRequest(input: SearchInput): ParallelRequest {
  const focus = input.focus ?? "general";
  const household = input.household_size
    ? ` The user mentioned a household size of ${input.household_size}. Treat that as unverified context, not eligibility.`
    : "";
  return {
    objective: `Find current free food, free meals, food helplines, or food benefits for a person in San Francisco ZIP code ${input.zip_code} who cannot afford food. Urgency: ${input.urgency ?? "unspecified"}. Focus: ${focus}.${household} Prefer official government and nonprofit pages. Need the program name, who it may help, how to access it, and any phone, hours, or address printed on the page. Do not treat outdated or out-of-city pages as local options.`,
    search_queries: foodQueries(input),
    mode: "fast",
    max_chars_total: 10000,
    advanced_settings: {
      location: "us",
      max_results: 8,
      source_policy: { exclude_domains: EXCLUDED_DOMAINS },
    },
  };
}

function relevant(blob: string): boolean {
  return FOOD_RELEVANT.test(blob);
}

function inScope(host: string, blob: string): boolean {
  if (OTHER_PLACE.test(blob) && !SAN_FRANCISCO.test(blob) && !isStatewide(host)) return false;
  return true;
}

function assistanceType(category: Category, blob: string): string {
  if (category === "food" && /restaurant meals program/i.test(blob)) return "Restaurant Meals Program";
  if (category === "food" && /\bwic\b/i.test(blob)) return "WIC (families with young children)";
  if (category === "food" && /food bank|pantry|pantries|free groceries/i.test(blob) && !/community meals?|soup kitchen|dining room/i.test(blob)) {
    return "Free groceries";
  }
  if (category === "food" && /free (hot )?meals?|hot meals?|soup kitchen|dining room|community meals?/i.test(blob)) return "Free meals";
  if (category === "food" && /home[- ]delivered|grocery delivery/i.test(blob)) return "Food delivery";
  if (category === "food" && /calfresh|snap/i.test(blob)) return "CalFresh / food assistance";
  if (category === "food" && /pantry|food bank/i.test(blob)) return "Food pantry";
  return "Food assistance";
}

/** Same page with different filters (?field=...) counts once. */
function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return url;
  }
}

const FOCUS_TERMS: Partial<Record<SearchFocus, RegExp>> = {
  meals: /free (hot )?meals?|hot meals?|community meals?|soup kitchen|dining room/i,
  restaurants: /restaurant meals program|restaurants?/i,
  families: /\bwic\b|school meals?|infants?|children/i,
  seniors: /older adults?|seniors?|disabilit/i,
  delivery: /deliver/i,
};

function pageIsOld(publishDate: string | null | undefined): boolean {
  if (!publishDate) return false;
  const parsed = Date.parse(publishDate);
  if (Number.isNaN(parsed)) return false;
  const eighteenMonths = 1000 * 60 * 60 * 24 * 30 * 18;
  return Date.now() - parsed > eighteenMonths;
}

function resourceId(url: string, index: number): string {
  let hash = 0;
  for (const char of url) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `resource_${hash.toString(16)}_${index + 1}`;
}

function uncertaintiesFor(parts: { hours: string | null; phone: string | null; address: string | null; publishDate?: string | null }): string {
  const notes = ["AidLine does not guarantee eligibility, hours, funding, or current availability."];
  if (!parts.hours) notes.push("Hours were not listed in the source excerpt.");
  if (!parts.phone) notes.push("No phone number was listed in the source excerpt.");
  if (!parts.address) notes.push("No street address was listed in the source excerpt.");
  if (pageIsOld(parts.publishDate)) notes.push(`The page date is ${parts.publishDate}. Confirm the page is still current.`);
  return notes.join(" ");
}

export function resourcesFromHits(input: SearchInput, hits: ParallelHit[]): Resource[] {
  const ranked: { resource: Resource; score: number }[] = [];
  const seen = new Set<string>();

  hits.forEach((hit, index) => {
    if (!hit.url || !/^https:\/\//i.test(hit.url)) return;
    const page = pageKey(hit.url);
    if (seen.has(page)) return;
    const host = hostOf(hit.url);
    if (!host || EXCLUDED_DOMAINS.some((domain) => matchesDomain(host, domain))) return;
    const excerpt = (hit.excerpts ?? []).join("\n").slice(0, 8000);
    const blob = `${hit.title ?? ""}\n${excerpt}`;
    if (!relevant(blob) || !inScope(host, blob)) return;

    // A directory lists many places; one address or time from it would mislead.
    const isDirectory = addressCount(blob) >= 2;
    const phone = extractPhone(blob);
    const hours = isDirectory ? null : extractHours(blob);
    const address = isDirectory ? null : extractAddress(blob);
    const official = isOfficialHost(host);
    const verification = official && (phone || hours || address) ? "verified" : official || phone || hours ? "partially_verified" : "needs_confirmation";
    let score = 0;
    if (official) score += 40;
    if (host.endsWith(".gov")) score += 10;
    if (blob.includes(input.zip_code)) score += 15;
    if (SAN_FRANCISCO.test(blob)) score += 8;
    if (phone) score += 10;
    if (hours) score += 10;
    if (address) score += 8;
    if ((input.focus ?? "general") !== "general") score += 4;
    const focusTerms = FOCUS_TERMS[input.focus ?? "general"];
    if (focusTerms?.test(blob)) score += 25;
    if (input.urgency === "today" && /today|emergency|distribution|pantry/i.test(blob)) {
      score += 8;
    }

    seen.add(page);
    ranked.push({
      score,
      resource: {
        id: resourceId(hit.url, index),
        name: cleanTitle(hit.title, hit.url),
        description: excerpt ? clip(excerpt, 320) : "The source page did not include a usable summary in search excerpts.",
        assistance_type: assistanceType(input.category, blob),
        address,
        phone,
        hours,
        eligibility: extractEligibility(blob),
        documents: extractDocuments(blob),
        action: isDirectory
          ? "This page lists several places. Open it to find the one closest to you, and call ahead to confirm hours."
          : phone
          ? "Call the number listed in the source and confirm they can help before you go."
          : "Open the official page and confirm hours, eligibility, and what to bring before you go.",
        source_url: hit.url,
        verification_status: verification,
        uncertainties: uncertaintiesFor({ hours, phone, address, publishDate: hit.publish_date }),
      },
    });
  });

  const top = ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.resource);
  return withHelpline(input, top);
}

/** For food searches, make sure there is always a number to call. */
function withHelpline(input: SearchInput, resources: Resource[]): Resource[] {
  if (resources.length === 0 || resources.some((item) => item.phone)) return resources;
  const line = bestHelpline(input.focus);
  if (resources.some((item) => item.source_url === line.source_url && item.name === line.name)) return resources;
  return [...resources.slice(0, 2), line];
}

function directory(input: {
  id: string;
  name: string;
  url: string;
  description: string;
  assistance_type: string;
  phone?: string;
}): Resource {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    assistance_type: input.assistance_type,
    address: null,
    phone: input.phone ?? null,
    hours: null,
    eligibility: null,
    documents: null,
    action: "Open the official site and confirm current details before you rely on them.",
    source_url: input.url,
    verification_status: "fallback_directory",
    uncertainties:
      "Live search did not return a current listing. This is an official starting point only. AidLine has not confirmed hours, eligibility, funding, or availability.",
  };
}

/**
 * Food helplines. Every number here was copied from the official page in source_url
 * (checked 2026-11-17). Re-check them if those pages change.
 */
const HELPLINE_NOTE =
  "Number copied from the official page linked here. Lines can be busy or have limited hours; AidLine has not confirmed availability or eligibility.";

function helpline(input: { id: string; name: string; url: string; description: string; assistance_type: string; phone: string; action: string }): Resource {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    assistance_type: input.assistance_type,
    address: null,
    phone: input.phone,
    hours: null,
    eligibility: null,
    documents: null,
    action: input.action,
    source_url: input.url,
    verification_status: "verified",
    uncertainties: HELPLINE_NOTE,
  };
}

export const FOOD_HELPLINES = {
  dial211: helpline({
    id: "helpline_211",
    name: "211 food help line",
    url: "https://www.sfmfoodbank.org/find-food/",
    assistance_type: "Food helpline",
    phone: "211",
    description: "Dial 2-1-1 for food options from other organizations. The SF-Marin Food Bank lists this on its Find Food page.",
    action: "Dial 2-1-1 and say you need free food in San Francisco and your ZIP code.",
  }),
  foodBank: helpline({
    id: "helpline_food_bank",
    name: "SF-Marin Food Bank",
    url: "https://www.sfmfoodbank.org/find-food/",
    assistance_type: "Free groceries",
    phone: "415-282-1900",
    description:
      "Free weekly groceries at pantries across San Francisco, one-time emergency food, and help applying for CalFresh. Its Find Food page also lists 415-824-3663 for grocery delivery if getting to a pantry is hard.",
    action: "Call or use the pantry locator on the Find Food page to find the closest pantry and its day.",
  }),
  calFresh: helpline({
    id: "helpline_calfresh",
    name: "CalFresh San Francisco",
    url: "https://www.sfhsa.org/services/food/calfresh",
    assistance_type: "CalFresh (EBT food money)",
    phone: "(855) 355-5757",
    description: "Monthly money on an EBT card for groceries. San Francisco Human Services Agency handles applications and questions.",
    action: "Call to ask about applying, or apply online through BenefitsCal or GetCalFresh.",
  }),
  olderAdults: helpline({
    id: "helpline_das_meals",
    name: "Free meals for older adults and people with disabilities (DAS)",
    url: "https://www.sfhsa.org/services/disability-aging/groceries-meals",
    assistance_type: "Free meals",
    phone: "(415) 355-6700",
    description: "San Francisco Disability and Aging Services offers free community meals across the city and home-delivered meals for people who cannot shop or cook.",
    action: "Call DAS to find a meal site near you or to apply for home-delivered meals.",
  }),
};

/** The phone line that best fits what the person asked for. */
export function bestHelpline(focus: SearchFocus | undefined): Resource {
  if (focus === "seniors") return FOOD_HELPLINES.olderAdults;
  if (focus === "restaurants" || focus === "eligibility" || focus === "application") return FOOD_HELPLINES.calFresh;
  if (focus === "delivery") return FOOD_HELPLINES.foodBank;
  return FOOD_HELPLINES.dial211;
}

export function foodHelplines(focus: SearchFocus | undefined): Resource[] {
  if (focus === "seniors") return [FOOD_HELPLINES.olderAdults, FOOD_HELPLINES.dial211, FOOD_HELPLINES.foodBank];
  return [FOOD_HELPLINES.dial211, FOOD_HELPLINES.foodBank, FOOD_HELPLINES.calFresh];
}

const FREE_FOOD_DIRECTORY = directory({
  id: "fallback_free_food_locations",
  name: "Free Food Locations in San Francisco",
  url: "https://www.sfhsa.org/services/food/free-food-locations",
  assistance_type: "Free meals and groceries",
  description: "The city's directory of free meals and groceries, with a filter for meals open to everyone. The page asks you to call ahead to confirm food and hours.",
});

export function fallbackResources(focus?: SearchFocus): Resource[] {
  if (focus === "helpline") return foodHelplines(focus);
  if (focus === "restaurants") {
    return [
      directory({
        id: "fallback_rmp",
        name: "CalFresh Restaurant Meals Program",
        url: "https://www.cdss.ca.gov/inforesources/calfresh/restaurant-meals-program",
        assistance_type: "Restaurant Meals Program",
        description: "State program that lets some CalFresh recipients, such as people who are older, disabled, or unhoused, buy hot meals at participating restaurants with EBT.",
      }),
      FOOD_HELPLINES.calFresh,
      FREE_FOOD_DIRECTORY,
    ];
  }
  if (focus === "seniors") return [FOOD_HELPLINES.olderAdults, FREE_FOOD_DIRECTORY, FOOD_HELPLINES.foodBank];
  if (focus === "families") {
    return [
      directory({
        id: "fallback_wic",
        name: "WIC in San Francisco",
        url: "https://www.sf.gov/women-infants-children-wic-supplemental-nutrition-program",
        assistance_type: "WIC (families with young children)",
        description: "Food benefits for pregnant people, new parents, and children under 5, run by the city.",
      }),
      directory({
        id: "fallback_school_meals",
        name: "SFUSD school meals",
        url: "https://www.sfusd.edu/services/health-wellness/nutrition-school-meals",
        assistance_type: "Free school meals",
        description: "San Francisco public schools' meal program page.",
      }),
      FOOD_HELPLINES.foodBank,
    ];
  }
  return [FREE_FOOD_DIRECTORY, FOOD_HELPLINES.foodBank, FOOD_HELPLINES.calFresh];
}

function response(input: SearchInput, searchStatus: SearchStatus, message: string, resources: Resource[]): SearchResponse {
  return {
    category: input.category,
    zip_code: input.zip_code,
    urgency: input.urgency ?? null,
    focus: input.focus ?? "general",
    search_status: searchStatus,
    message,
    resources,
    searched_at: new Date().toISOString(),
  };
}

function spokenOk(input: SearchInput, resources: Resource[]): string {
  const names = resources.map((item) => item.name).join(", ");
  const hoursKnown = resources.some((item) => item.hours);
  const hoursNote = hoursKnown
    ? "Any hours on the cards came from the source pages. Please confirm before visiting."
    : "Those sources did not list hours I can confirm, so please check before you go.";
  const call = " If you'd rather talk to someone, you can dial 2-1-1 for food help.";
  return `I found ${resources.length} possible option${resources.length === 1 ? "" : "s"} around ${input.zip_code}: ${names}.${spokenDecision(resources)} ${hoursNote}${call}`;
}

const FAILED_MESSAGE =
  "I couldn't retrieve live results just now. These are official starting points, not a confirmation that help is available today.";

export async function searchAssistance(
  input: SearchInput,
  options: { timeoutMs?: number; decisionTimeoutMs?: number } = {},
): Promise<SearchResponse> {
  if (!isSanFranciscoZip(input.zip_code)) {
    return response(
      input,
      "outside_area",
      "AidLine currently covers San Francisco. If you have a San Francisco ZIP code, share it and I can look.",
      [],
    );
  }

  if (input.focus === "helpline") {
    const lines = foodHelplines(input.focus);
    return response(
      input,
      "ok",
      `Here are numbers you can call. You can dial 2-1-1 for food help, call the SF-Marin Food Bank at 415-282-1900, or call CalFresh San Francisco at 855-355-5757. Lines can be busy, so call early if you can.`,
      lines,
    );
  }

  const fallback = fallbackResources(input.focus);
  const key = process.env.PARALLEL_API_KEY?.trim();
  if (!key && !freeSearchEnabled()) {
    return response(input, "unavailable", FAILED_MESSAGE, fallback);
  }

  try {
    const request = buildSearchRequest(input);
    let hits: ParallelHit[];
    if (key) {
      const parallel = await fetch("https://api.parallel.ai/v1/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      });
      if (!parallel.ok) {
        const detail = await parallel.text();
        console.error(`Parallel search failed (${parallel.status}): ${detail.slice(0, 400)}`);
        return response(input, "unavailable", FAILED_MESSAGE, fallback);
      }
      const payload = (await parallel.json()) as { results?: ParallelHit[] };
      hits = payload.results ?? [];
    } else {
      // No key: Parallel's free, rate-limited MCP search.
      hits = await mcpWebSearch(request, { timeoutMs: options.timeoutMs ?? 20000 });
    }
    const found = resourcesFromHits(input, hits);
    // Parallel Decisions checks each place: does it give free food, who can go, is it open today.
    const resources = found.length ? await decideResources(input, found, { timeoutMs: options.decisionTimeoutMs }) : found;
    if (resources.length === 0) {
      return response(
        input,
        "no_results",
        "I searched and did not find a current listing I can stand behind. These official starting points are the next place to check, and you should confirm what is available.",
        fallback,
      );
    }
    return response(input, "ok", spokenOk(input, resources), resources);
  } catch (error) {
    console.error("Parallel search error", error instanceof Error ? error.message : error);
    return response(input, "unavailable", FAILED_MESSAGE, fallback);
  }
}

export function toolResultForAgent(result: SearchResponse) {
  return {
    speak_this: result.message,
    rules:
      "Use speak_this as the basis of the spoken reply. Mention a phone, hour, or address only if that field is non-null. If a field is null, say it was not listed. Do not promise eligibility, funding, or that food is in stock. The decision fields are Parallel Decisions estimates from public sources: describe them as likely or unlikely, never as certain, and never as an eligibility decision.",
    search_status: result.search_status,
    category: result.category,
    zip_code: result.zip_code,
    urgency: result.urgency,
    resources: result.resources.map((resource) => ({
      name: resource.name,
      assistance_type: resource.assistance_type,
      phone: resource.phone,
      hours: resource.hours,
      address: resource.address,
      eligibility: resource.eligibility,
      action: resource.action,
      source_url: resource.source_url,
      verification_status: resource.verification_status,
      decision: resource.decision
        ? {
            gives_free_food_probability: resource.decision.offers_food,
            who_can_go: resource.decision.audience,
            open_today_probability: resource.decision.open_today,
            day: resource.decision.day,
          }
        : null,
    })),
  };
}

export type { SearchFocus, Urgency };
