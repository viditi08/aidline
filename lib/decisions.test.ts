import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDecisionRequest,
  decideResources,
  parseDecision,
  rankByDecision,
  spokenDecision,
  todayInSanFrancisco,
} from "@/lib/decisions";
import { FOOD_HELPLINES } from "@/lib/search";
import type { Resource, ResourceDecision, SearchInput } from "@/lib/types";

function place(id: string, decision?: Partial<ResourceDecision>): Resource {
  return {
    id,
    name: `Place ${id}`,
    description: "Free meals",
    assistance_type: "Free meals",
    address: null,
    phone: null,
    hours: null,
    eligibility: null,
    documents: null,
    action: "Call ahead.",
    source_url: `https://www.sfhsa.org/${id}`,
    verification_status: "partially_verified",
    uncertainties: "Not confirmed.",
    decision: decision
      ? { offers_food: null, audience: null, audience_confidence: null, open_today: null, day: "Tuesday", citations: [], decision_id: null, ...decision }
      : undefined,
  };
}

const today: SearchInput = { category: "food", zip_code: "94102", urgency: "today", focus: "general" };
const ongoing: SearchInput = { category: "food", zip_code: "94102", urgency: "ongoing", focus: "general" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Parallel Decisions request", () => {
  it("asks whether it gives free food and who can go, as typed questions", () => {
    const request = buildDecisionRequest(place("a"), ongoing, "Tuesday");
    expect(request.questions.offers_food.type).toBe("noul");
    expect(request.questions.who_can_go.type).toBe("choice");
    expect(Object.keys(request.questions.who_can_go.criteria ?? {})).toEqual(["anyone", "specific_group", "application_required"]);
    expect(request.questions.open_today).toBeUndefined();
    expect(request.state).toMatchObject({ source_url: "https://www.sfhsa.org/a", zip_code: "94102" });
  });

  it("adds an open-today question when food is needed today", () => {
    const request = buildDecisionRequest(place("a"), today, "Tuesday");
    expect(request.questions.open_today?.instructions).toMatch(/Tuesday/);
  });

  it("uses San Francisco's day of the week", () => {
    // 2026-11-17 06:00 UTC is still Monday evening in San Francisco.
    expect(todayInSanFrancisco(new Date("2026-11-17T06:00:00Z"))).toBe("Monday");
  });
});

describe("Parallel Decisions response", () => {
  it("reads probabilities, the chosen group, and citations", () => {
    const decision = parseDecision(
      {
        answers: {
          offers_food: { type: "noul", noul: 0.99 },
          who_can_go: { type: "choice", choice: "specific_group", confidence: 0.92 },
          open_today: { type: "noul", noul: 0.8 },
        },
        citations: [{ url: "https://www.sfhsa.org/x", title: "Community Meals" }, { url: "http://insecure.example" }],
        decision_id: "decisions_1",
      },
      "Tuesday",
    );
    expect(decision).toMatchObject({ offers_food: 0.99, audience: "specific_group", open_today: 0.8, decision_id: "decisions_1" });
    expect(decision.citations).toEqual([{ url: "https://www.sfhsa.org/x", title: "Community Meals" }]);
  });

  it("treats a refusal as unknown, not as a no", () => {
    const decision = parseDecision({ answers: { offers_food: { type: "refusal" }, who_can_go: { type: "refusal" } } }, "Tuesday");
    expect(decision.offers_food).toBeNull();
    expect(decision.audience).toBeNull();
  });
});

describe("ranking with decisions", () => {
  it("drops places that probably do not give free food", () => {
    const ranked = rankByDecision(ongoing, [place("a", { offers_food: 0.1 }), place("b", { offers_food: 0.9 })]);
    expect(ranked.map((item) => item.id)).toEqual(["b"]);
  });

  it("never drops everything", () => {
    const ranked = rankByDecision(ongoing, [place("a", { offers_food: 0.1 })]);
    expect(ranked).toHaveLength(1);
  });

  it("puts places likely open today first when food is needed today", () => {
    const ranked = rankByDecision(today, [place("a", { open_today: 0.2 }), place("b", { open_today: 0.9 }), place("c")]);
    expect(ranked.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps search order when food is not needed today", () => {
    const ranked = rankByDecision(ongoing, [place("a", { open_today: 0.2 }), place("b", { open_today: 0.9 })]);
    expect(ranked.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("words the spoken estimate carefully", () => {
    const text = spokenDecision([place("a", { open_today: 0.85, audience: "anyone" })]);
    expect(text).toMatch(/Parallel Decisions estimates Place a is likely serving food on Tuesday/);
    expect(text).toMatch(/open to anyone/);
    expect(text).toMatch(/estimate/);
  });
});

describe("decideResources", () => {
  it("calls the Decisions API with the key and skips curated helplines", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ answers: { offers_food: { type: "noul", noul: 0.95 } }, citations: [] }), { status: 200 }),
    );
    const result = await decideResources(ongoing, [place("a"), FOOD_HELPLINES.dial211]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.parallel.ai/v1/decisions");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    expect(result[0]?.decision?.offers_food).toBe(0.95);
    expect(result[1]?.decision).toBeUndefined();
  });

  it("keeps the search results if Decisions fails", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "test-key");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await decideResources(ongoing, [place("a")]);
    expect(result.map((item) => item.id)).toEqual(["a"]);
    expect(result[0]?.decision).toBeUndefined();
  });

  it("can be turned off", async () => {
    vi.stubEnv("PARALLEL_DECISIONS", "off");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await decideResources(ongoing, [place("a")]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
