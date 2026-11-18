import { afterEach, describe, expect, it, vi } from "vitest";
import { hitsFromToolResult, parseRpcBody } from "@/lib/parallel-mcp";
import { FOCUS_VALUES } from "@/lib/types";
import { buildSearchRequest, FOOD_HELPLINES, resourcesFromHits, searchAssistance, type ParallelHit } from "@/lib/search";

const OFFICIAL_NUMBERS = new Set(Object.values(FOOD_HELPLINES).map((line) => line.phone));

const pantry: ParallelHit = {
  url: "https://www.sfhsa.org/services/food-assistance",
  title: "Food Assistance | SF Human Services Agency",
  publish_date: "2026-01-15",
  excerpts: [
    "CalFresh can help buy groceries. The office at 1235 Mission Street, San Francisco is open Monday through Friday, 8:00 a.m. to 5:00 p.m. Call (415) 558-1001. Bring a photo ID. You may qualify if your household income is under the program limit.",
  ],
};

const blog: ParallelHit = {
  url: "https://example.org/sf-food-tips",
  title: "My food tips",
  excerpts: ["A personal blog about food in San Francisco with no phone, hours, or address."],
};

describe("search request", () => {
  it("builds short food queries for a same-day lookup", () => {
    const request = buildSearchRequest({ category: "food", zip_code: "94103", urgency: "today", focus: "general" });
    expect(request.mode).toBe("fast");
    expect(request.search_queries).toHaveLength(3);
    for (const item of request.search_queries) {
      const words = item.split(/\s+/);
      expect(words.length).toBeGreaterThanOrEqual(3);
      expect(words.length).toBeLessThanOrEqual(6);
    }
    expect(request.search_queries[0]).toContain("94103");
    expect(request.advanced_settings.source_policy.exclude_domains).toContain("reddit.com");
  });

  it("builds short food queries for every focus", () => {
    for (const focus of FOCUS_VALUES) {
      const request = buildSearchRequest({ category: "food", zip_code: "94103", urgency: "today", focus });
      expect(request.search_queries.length).toBeGreaterThan(0);
      for (const item of request.search_queries) {
        const words = item.split(/\s+/);
        expect(words.length).toBeGreaterThanOrEqual(3);
        expect(words.length).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe("resource extraction", () => {
  it("keeps only facts that appear in the source and prefers the official page", () => {
    const resources = resourcesFromHits({ category: "food", zip_code: "94103", urgency: "today" }, [blog, pantry]);
    expect(resources.map((item) => item.source_url)).toContain(pantry.url);
    const official = resources.find((item) => item.source_url === pantry.url);
    expect(official?.phone).toBe("(415) 558-1001");
    expect(official?.hours).toMatch(/Monday/i);
    expect(official?.address).toMatch(/1235 Mission Street/);
    expect(official?.eligibility).toMatch(/qualify/i);
    expect(official?.documents).toMatch(/photo ID/i);
    expect(official?.verification_status).toBe("verified");
    expect(JSON.stringify(resources)).not.toContain("555-0199");
  });

  it("leaves missing facts empty instead of inventing them", () => {
    const resources = resourcesFromHits({ category: "food", zip_code: "94110" }, [blog]);
    expect(resources[0]?.source_url).toBe(blog.url);
    expect(resources[0]?.phone).toBeNull();
    expect(resources[0]?.hours).toBeNull();
    expect(resources[0]?.address).toBeNull();
    expect(resources[0]?.verification_status).not.toBe("verified");
  });

  it("adds an official helpline when no food result has a number to call", () => {
    const resources = resourcesFromHits({ category: "food", zip_code: "94110" }, [blog]);
    expect(resources).toHaveLength(2);
    expect(resources[1]?.phone).toBe("211");
  });

  it("does not add a helpline when a result already has a phone", () => {
    const resources = resourcesFromHits({ category: "food", zip_code: "94103" }, [pantry, blog]);
    expect(resources.some((item) => item.id.startsWith("helpline_"))).toBe(false);
  });

  it("drops pages about other cities", () => {
    const resources = resourcesFromHits({ category: "food", zip_code: "94103" }, [
      {
        url: "https://example.org/oakland-pantry",
        title: "Oakland food pantry",
        excerpts: ["This food pantry serves Oakland residents only."],
      },
    ]);
    expect(resources).toHaveLength(0);
  });

  it("returns at most three resources", () => {
    const hits = Array.from({ length: 6 }, (_, index) => ({
      url: `https://www.sfhsa.org/food-${index}`,
      title: `Food pantry ${index}`,
      excerpts: ["San Francisco food pantry with groceries."],
    }));
    expect(resourcesFromHits({ category: "food", zip_code: "94103" }, hits)).toHaveLength(3);
  });
});

describe("searchAssistance without a key", () => {
  const previous = process.env.PARALLEL_API_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.PARALLEL_API_KEY;
    else process.env.PARALLEL_API_KEY = previous;
  });

  it("shows official starting points and does not invent contact details", async () => {
    delete process.env.PARALLEL_API_KEY;
    vi.stubEnv("PARALLEL_FREE_SEARCH", "off");
    const result = await searchAssistance({ category: "food", zip_code: "94103", urgency: "today" });
    vi.unstubAllEnvs();
    expect(result.search_status).toBe("unavailable");
    expect(result.resources).toHaveLength(3);
    for (const resource of result.resources) {
      if (resource.phone) {
        expect(OFFICIAL_NUMBERS.has(resource.phone)).toBe(true);
      } else {
        expect(resource.verification_status).toBe("fallback_directory");
      }
      expect(resource.hours).toBeNull();
      expect(resource.address).toBeNull();
      expect(resource.source_url.startsWith("https://")).toBe(true);
    }
    expect(result.message).toMatch(/starting points/i);
  });
});

describe("food helplines", () => {
  it("answers a helpline request with official numbers and no web search", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await searchAssistance({ category: "food", zip_code: "94103", focus: "helpline" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(result.search_status).toBe("ok");
    expect(result.resources.map((item) => item.phone)).toEqual(["211", "415-282-1900", "(855) 355-5757"]);
    expect(result.message).toMatch(/2-1-1/);
  });

  it("points restaurant questions to the Restaurant Meals Program", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "");
    vi.stubEnv("PARALLEL_FREE_SEARCH", "off");
    const result = await searchAssistance({ category: "food", zip_code: "94103", focus: "restaurants" });
    vi.unstubAllEnvs();
    expect(result.resources[0]?.name).toMatch(/Restaurant Meals Program/);
  });
});

describe("Parallel free search (MCP)", () => {
  it("reads search results from an event-stream response", () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"isError":false,"structuredContent":{"results":[{"url":"https://www.sfhsa.org/x","title":"Free Food"}]}}}\n\n';
    const hits = hitsFromToolResult(parseRpcBody(body).find((message) => message.id === 2));
    expect(hits).toEqual([{ url: "https://www.sfhsa.org/x", title: "Free Food" }]);
  });

  it("raises tool errors instead of returning empty results", () => {
    expect(() => hitsFromToolResult({ id: 2, result: { isError: true, content: [{ type: "text", text: "rate limited" }] } })).toThrow(/rate limited/);
  });
});

describe("directory pages", () => {
  it("does not present one entry of a list as the whole page's address or hours", () => {
    const directoryHit: ParallelHit = {
      url: "https://www.sfhsa.org/services/food/free-food-locations",
      title: "Free Food Locations in San Francisco",
      excerpts: [
        "Free meals and groceries. APA Family Support Services - Groceries 518 Grant Avenue, San Francisco, CA 94108 Monday: 12:00 p.m. to 2:30 p.m. Glide - Meals 330 Ellis Street, San Francisco, CA 94102 Daily: 8:00 a.m. to 9:00 a.m.",
      ],
    };
    const [resource] = resourcesFromHits({ category: "food", zip_code: "94102" }, [directoryHit]);
    expect(resource?.address).toBeNull();
    expect(resource?.hours).toBeNull();
    expect(resource?.action).toMatch(/lists several places/i);
  });
});

