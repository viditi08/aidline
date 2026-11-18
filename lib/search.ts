import { clip, cleanTitle, extractAddress, extractDocuments, extractEligibility, extractHours, extractPhone } from "@/lib/extract";
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
  "pge.com",
  "cpuc.ca.gov",
  "csd.ca.gov",
  "211bayarea.org",
];

const STATEWIDE_DOMAINS = ["ca.gov", "getcalfresh.org", "benefitscal.com", "pge.com", "cpuc.ca.gov", "csd.ca.gov", "cdss.ca.gov"];

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
const FOOD_RELEVANT = /\b(food|pantry|calfresh|snap|meal|meals|grocery|groceries|hunger|nutrition|wic)\b/i;
const UTILITY_RELEVANT = /\b(utility|utilities|electric|electricity|pge|pg&e|liheap|energy|disconnect|shut-?off|fera|\bcare\b|bill|power)\b/i;

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
  return [query(`San Francisco food pantry ${zip}`), query("SF-Marin Food Bank distribution"), query("CalFresh San Francisco apply")];
}

function utilityQueries(input: SearchInput): string[] {
  const provider = (input.utility_provider ?? "").toLowerCase();
  const namedPge = provider.includes("pg&e") || provider.includes("pge") || provider.includes("pacific gas");
  const focus = input.focus ?? "general";
  const lead = namedPge ? "PG&E" : provider.includes("clean") ? "CleanPowerSF" : "San Francisco utility";

  if (focus === "hours") {
    return [
      query(namedPge ? "PG&E customer service phone" : `${lead} customer service phone`),
      query("LIHEAP California contact"),
      query("CPUC consumer help phone"),
    ];
  }
  if (focus === "eligibility") {
    return [query("LIHEAP income eligibility California"), query(namedPge ? "PG&E CARE FERA eligibility" : "California utility assistance eligibility"), query("San Francisco utility assistance eligibility")];
  }
  if (focus === "application") {
    return [query("apply LIHEAP California"), query(namedPge ? "PG&E CARE application" : "California utility assistance apply"), query("San Francisco utility assistance apply")];
  }
  if (focus === "delivery") {
    return [query("PG&E medical baseline program"), query("California utility shutoff protection"), query("LIHEAP San Francisco assistance")];
  }
  return [
    query(namedPge ? "PG&E disconnection assistance" : input.urgency === "emergency" ? "utility shutoff assistance California" : "San Francisco utility bill help"),
    query("California LIHEAP apply"),
    query("CPUC utility disconnection protection"),
  ];
}

export function buildSearchRequest(input: SearchInput): ParallelRequest {
  const focus = input.focus ?? "general";
  const household = input.household_size
    ? ` The user mentioned a household size of ${input.household_size}. Treat that as unverified context, not eligibility.`
    : "";
  const provider = input.utility_provider ? ` Utility provider named by the user: ${input.utility_provider}.` : "";
  return {
    objective: `Find current ${input.category} assistance for a person in San Francisco ZIP code ${input.zip_code}. Urgency: ${input.urgency ?? "unspecified"}. Focus: ${focus}.${provider}${household} Prefer official government, utility, and nonprofit pages. Need the program name, who it may help, how to access it, and any phone, hours, or address printed on the page. Do not treat outdated or out-of-city pages as local options.`,
    search_queries: input.category === "food" ? foodQueries(input) : utilityQueries(input),
    mode: "fast",
    max_chars_total: 10000,
    advanced_settings: {
      location: "us",
      max_results: 8,
      source_policy: { exclude_domains: EXCLUDED_DOMAINS },
    },
  };
}

function relevant(category: Category, blob: string): boolean {
  return category === "food" ? FOOD_RELEVANT.test(blob) : UTILITY_RELEVANT.test(blob);
}

function inScope(host: string, blob: string): boolean {
  if (OTHER_PLACE.test(blob) && !SAN_FRANCISCO.test(blob) && !isStatewide(host)) return false;
  return true;
}

function assistanceType(category: Category, blob: string): string {
  if (category === "food" && /calfresh|snap/i.test(blob)) return "CalFresh / food assistance";
  if (category === "food" && /pantry|food bank/i.test(blob)) return "Food pantry";
  if (category === "utility" && /liheap/i.test(blob)) return "Utility bill assistance (LIHEAP)";
  if (category === "utility" && /\b(care|fera)\b/i.test(blob)) return "Utility bill discount";
  return category === "food" ? "Food assistance" : "Utility assistance";
}

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
    if (!hit.url || !/^https:\/\//i.test(hit.url) || seen.has(hit.url)) return;
    const host = hostOf(hit.url);
    if (!host || EXCLUDED_DOMAINS.some((domain) => matchesDomain(host, domain))) return;
    const excerpt = (hit.excerpts ?? []).join("\n").slice(0, 8000);
    const blob = `${hit.title ?? ""}\n${excerpt}`;
    if (!relevant(input.category, blob) || !inScope(host, blob)) return;

    const phone = extractPhone(blob);
    const hours = extractHours(blob);
    const address = extractAddress(blob);
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
    if ((input.urgency === "today" || input.urgency === "emergency") && /today|emergency|distribution|pantry|disconnection|shut-?off/i.test(blob)) {
      score += 8;
    }

    seen.add(hit.url);
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
        action: phone
          ? "Call the number listed in the source and confirm they can help before you go."
          : "Open the official page and confirm hours, eligibility, and what to bring before you go.",
        source_url: hit.url,
        verification_status: verification,
        uncertainties: uncertaintiesFor({ hours, phone, address, publishDate: hit.publish_date }),
      },
    });
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.resource);
}

function directory(input: {
  id: string;
  name: string;
  url: string;
  description: string;
  assistance_type: string;
}): Resource {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    assistance_type: input.assistance_type,
    address: null,
    phone: null,
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

export function fallbackResources(category: Category): Resource[] {
  if (category === "food") {
    return [
      directory({
        id: "fallback_food_bank",
        name: "SF-Marin Food Bank",
        url: "https://www.sfmfoodbank.org/",
        assistance_type: "Food assistance",
        description: "Official website for the SF-Marin Food Bank. Use it to look up current food distributions. AidLine could not retrieve a live listing.",
      }),
      directory({
        id: "fallback_sfhsa",
        name: "San Francisco Human Services Agency",
        url: "https://www.sfhsa.org/",
        assistance_type: "Food assistance",
        description: "Official San Francisco Human Services Agency site, a starting point for CalFresh and other benefits. Current eligibility is not confirmed here.",
      }),
      directory({
        id: "fallback_calfresh",
        name: "GetCalFresh",
        url: "https://www.getcalfresh.org/",
        assistance_type: "CalFresh / food assistance",
        description: "Official CalFresh application start page. AidLine cannot tell you whether you qualify.",
      }),
    ];
  }
  return [
    directory({
      id: "fallback_pge",
      name: "PG&E",
      url: "https://www.pge.com/",
      assistance_type: "Utility assistance",
      description: "Official PG&E website. If a shutoff is soon, contact the utility directly from this site. AidLine has not confirmed account status or funding.",
    }),
    directory({
      id: "fallback_liheap",
      name: "California Department of Community Services and Development",
      url: "https://www.csd.ca.gov/",
      assistance_type: "Utility bill assistance (LIHEAP)",
      description: "Official state site for energy assistance programs, including LIHEAP. Availability of funds is not confirmed.",
    }),
    directory({
      id: "fallback_cpuc",
      name: "California Public Utilities Commission",
      url: "https://www.cpuc.ca.gov/",
      assistance_type: "Utility assistance",
      description: "Official consumer site for California utility rules and shutoff protections. Confirm any protection with the utility and the CPUC page.",
    }),
  ];
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
  if (input.category === "utility" && (input.urgency === "emergency" || input.urgency === "today")) {
    return `Contact your utility provider first. I also found ${resources.length} possible option${resources.length === 1 ? "" : "s"}: ${names}. ${hoursNote}`;
  }
  return `I found ${resources.length} possible option${resources.length === 1 ? "" : "s"} around ${input.zip_code}: ${names}. ${hoursNote}`;
}

const FAILED_MESSAGE =
  "I couldn't retrieve live results just now. These are official starting points, not a confirmation that help is available today.";

export async function searchAssistance(
  input: SearchInput,
  options: { timeoutMs?: number } = {},
): Promise<SearchResponse> {
  if (!isSanFranciscoZip(input.zip_code)) {
    return response(
      input,
      "outside_area",
      "AidLine currently covers San Francisco. If you have a San Francisco ZIP code, share it and I can look.",
      [],
    );
  }

  const key = process.env.PARALLEL_API_KEY?.trim();
  if (!key) {
    return response(input, "unavailable", FAILED_MESSAGE, fallbackResources(input.category));
  }

  try {
    const parallel = await fetch("https://api.parallel.ai/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify(buildSearchRequest(input)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
    });
    if (!parallel.ok) {
      const detail = await parallel.text();
      console.error(`Parallel search failed (${parallel.status}): ${detail.slice(0, 400)}`);
      return response(input, "unavailable", FAILED_MESSAGE, fallbackResources(input.category));
    }
    const payload = (await parallel.json()) as { results?: ParallelHit[] };
    const resources = resourcesFromHits(input, payload.results ?? []);
    if (resources.length === 0) {
      return response(
        input,
        "no_results",
        "I searched and did not find a current listing I can stand behind. These official starting points are the next place to check, and you should confirm what is available.",
        fallbackResources(input.category),
      );
    }
    return response(input, "ok", spokenOk(input, resources), resources);
  } catch (error) {
    console.error("Parallel search error", error instanceof Error ? error.message : error);
    return response(input, "unavailable", FAILED_MESSAGE, fallbackResources(input.category));
  }
}

export function toolResultForAgent(result: SearchResponse) {
  return {
    speak_this: result.message,
    rules:
      "Use speak_this as the basis of the spoken reply. Mention a phone, hour, or address only if that field is non-null. If a field is null, say it was not listed. Do not promise eligibility, funding, or that food is in stock.",
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
    })),
  };
}

export type { SearchFocus, Urgency };
