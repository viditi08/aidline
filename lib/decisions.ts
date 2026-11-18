import { freeSearchEnabled, mcpCallTool } from "@/lib/parallel-mcp";
export { AUDIENCE_LABEL, percent } from "@/lib/decision-labels";
import type { Audience, Resource, ResourceDecision, SearchInput } from "@/lib/types";

/**
 * Parallel Decisions: typed, source-backed judgments about each place AidLine found.
 * https://docs.parallel.ai/decisions/question-types
 *
 * For every resource we ask:
 *  - offers_food (noul): probability it really gives free food in San Francisco now.
 *  - who_can_go (choice): open to anyone, a specific group, or application first.
 *  - open_today (noul): only when the person needs food today or asks about hours.
 *
 * These are estimates from public sources. They never decide eligibility.
 */

const DECISIONS_URL = "https://api.parallel.ai/v1/decisions";

/** Below this, a result probably is not a free food source, so it is dropped. */
export const MIN_OFFERS_FOOD = 0.25;

const AUDIENCE_CRITERIA: Record<Audience, string> = {
  anyone: "Open to anyone who needs food. No ID, income proof, age, or address requirement is stated.",
  specific_group:
    "Limited to a group, such as older adults, people with disabilities, families with children, students, or residents of certain ZIP codes.",
  application_required: "Requires applying or enrolling before getting food, such as CalFresh, WIC, or a registration.",
};

export interface DecisionQuestion {
  type: "noul" | "choice";
  instructions: string;
  criteria?: Record<string, string>;
}

export interface DecisionRequest {
  state: Record<string, unknown>;
  questions: Record<string, DecisionQuestion>;
}

interface DecisionAnswer {
  type: "noul" | "choice" | "score" | "refusal";
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface DecisionResponse {
  answers?: Record<string, DecisionAnswer>;
  citations?: { url: string; title?: string | null }[];
  decision_id?: string;
}

export function todayInSanFrancisco(now = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "America/Los_Angeles" }).format(now);
}

export function wantsOpenToday(input: SearchInput): boolean {
  return input.urgency === "today" || input.focus === "hours" || input.focus === "meals";
}

export function buildDecisionRequest(resource: Resource, input: SearchInput, day: string): DecisionRequest {
  const subject = `"${resource.name}" (${resource.source_url})`;
  const questions: Record<string, DecisionQuestion> = {
    offers_food: {
      type: "noul",
      instructions: `Using the source page and official San Francisco sources, ${subject} currently provides free food, free meals, free groceries, or food benefits to people in San Francisco.`,
      criteria: {
        true: "Official or reputable sources show it currently gives free food, meals, groceries, or food benefits in San Francisco.",
        false: "It does not give food, has closed, is outside San Francisco, or is only general information with no way to get food.",
      },
    },
    who_can_go: {
      type: "choice",
      instructions: `According to official sources, who can get food from ${subject}? Decline if the sources do not say.`,
      criteria: AUDIENCE_CRITERIA,
    },
  };
  if (wantsOpenToday(input)) {
    questions.open_today = {
      type: "noul",
      instructions: `According to its current official schedule, ${subject} serves food or is open to give out food on ${day}.`,
      criteria: {
        true: `The schedule shows food service or open hours on ${day}.`,
        false: `The schedule shows no service on ${day}, or it is closed.`,
      },
    };
  }
  return {
    state: {
      service: resource.name,
      source_url: resource.source_url,
      city: "San Francisco, California",
      zip_code: input.zip_code,
      day,
      what_the_person_needs: input.focus ?? "general",
    },
    questions,
  };
}

function probability(answer: DecisionAnswer | undefined): number | null {
  if (!answer || answer.type !== "noul" || typeof answer.noul !== "number") return null;
  return Math.max(0, Math.min(1, answer.noul));
}

export function parseDecision(response: DecisionResponse, day: string): ResourceDecision {
  const answers = response.answers ?? {};
  const who = answers.who_can_go;
  const audience =
    who?.type === "choice" && who.choice && who.choice in AUDIENCE_CRITERIA ? (who.choice as Audience) : null;
  return {
    offers_food: probability(answers.offers_food),
    audience,
    audience_confidence: audience && typeof who?.confidence === "number" ? who.confidence : null,
    open_today: probability(answers.open_today),
    day,
    citations: (response.citations ?? [])
      .filter((item) => typeof item?.url === "string" && /^https:\/\//i.test(item.url))
      .slice(0, 3)
      .map((item) => ({ url: item.url, title: item.title?.trim() || null })),
    decision_id: response.decision_id ?? null,
  };
}

async function callDecisions(request: DecisionRequest, timeoutMs: number): Promise<DecisionResponse> {
  const key = process.env.PARALLEL_API_KEY?.trim();
  if (key) {
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Parallel Decisions failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    }
    return (await response.json()) as DecisionResponse;
  }
  // No key: the same Decisions engine through Parallel's free MCP tool.
  return (await mcpCallTool("web_decisions", { ...request }, { timeoutMs })) as DecisionResponse;
}

export function decisionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.PARALLEL_DECISIONS ?? "").trim().toLowerCase() === "off") return false;
  return Boolean(env.PARALLEL_API_KEY?.trim()) || freeSearchEnabled(env);
}

/** Curated helplines and fallback links are already checked by hand; skip them. */
function needsDecision(resource: Resource): boolean {
  return !resource.id.startsWith("helpline_") && !resource.id.startsWith("fallback_");
}

/**
 * Runs one Decisions call per resource, in parallel. Drops places that probably do not
 * give free food. When the person needs food today, places likely open today come first.
 * If Decisions fails, the original results are returned unchanged.
 */
export async function decideResources(
  input: SearchInput,
  resources: Resource[],
  options: { timeoutMs?: number; now?: Date } = {},
): Promise<Resource[]> {
  if (!decisionsEnabled() || resources.length === 0) return resources;
  const day = todayInSanFrancisco(options.now);
  const timeoutMs = options.timeoutMs ?? 15000;

  const decided = await Promise.all(
    resources.map(async (resource) => {
      if (!needsDecision(resource)) return resource;
      try {
        const response = await callDecisions(buildDecisionRequest(resource, input, day), timeoutMs);
        return { ...resource, decision: parseDecision(response, day) };
      } catch (error) {
        console.error("Parallel Decisions error", error instanceof Error ? error.message : error);
        return resource;
      }
    }),
  );

  return rankByDecision(input, decided);
}

export function rankByDecision(input: SearchInput, resources: Resource[]): Resource[] {
  const kept = resources.filter((item) => {
    const offers = item.decision?.offers_food;
    return offers == null || offers >= MIN_OFFERS_FOOD;
  });
  // Never leave someone with nothing: if every result was dropped, keep the original list.
  const list = kept.length > 0 ? kept : resources;
  if (!wantsOpenToday(input)) return list;
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const openA = a.item.decision?.open_today ?? -1;
      const openB = b.item.decision?.open_today ?? -1;
      if (openA === -1 && openB === -1) return a.index - b.index;
      if (Math.abs(openA - openB) < 0.15) return a.index - b.index;
      return openB - openA;
    })
    .map(({ item }) => item);
}

/** Short spoken note about the top result, worded as an estimate. */
export function spokenDecision(resources: Resource[]): string {
  const top = resources.find((item) => item.decision);
  const decision = top?.decision;
  if (!top || !decision) return "";
  const parts: string[] = [];
  if (decision.open_today != null) {
    const likely = decision.open_today >= 0.7 ? "likely" : decision.open_today >= 0.4 ? "possibly" : "probably not";
    parts.push(`Parallel Decisions estimates ${top.name} is ${likely} serving food on ${decision.day}`);
  }
  if (decision.audience === "anyone") parts.push(`${parts.length ? "and that it is" : `Parallel Decisions estimates ${top.name} is`} open to anyone`);
  if (decision.audience === "specific_group") parts.push(`${parts.length ? "and that it is" : `Parallel Decisions estimates ${top.name} is`} for a specific group`);
  if (decision.audience === "application_required") parts.push(`${parts.length ? "and that it" : `Parallel Decisions estimates ${top.name}`} needs an application first`);
  return parts.length ? ` ${parts.join(" ")}. That is an estimate, so please call ahead.` : "";
}
