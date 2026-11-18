import { afterEach, describe, expect, it } from "vitest";
import { buildSearchRequest, resourcesFromHits, searchAssistance, type ParallelHit } from "@/lib/search";

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

  it("builds utility queries for every follow-up focus", () => {
    for (const focus of ["general", "hours", "eligibility", "delivery", "application"] as const) {
      const request = buildSearchRequest({
        category: "utility",
        zip_code: "94103",
        urgency: "emergency",
        utility_provider: "PG&E",
        focus,
      });
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
    expect(resources).toHaveLength(1);
    expect(resources[0]?.phone).toBeNull();
    expect(resources[0]?.hours).toBeNull();
    expect(resources[0]?.address).toBeNull();
    expect(resources[0]?.verification_status).not.toBe("verified");
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
    const result = await searchAssistance({ category: "food", zip_code: "94103", urgency: "today" });
    expect(result.search_status).toBe("unavailable");
    expect(result.resources).toHaveLength(3);
    for (const resource of result.resources) {
      expect(resource.verification_status).toBe("fallback_directory");
      expect(resource.phone).toBeNull();
      expect(resource.hours).toBeNull();
      expect(resource.address).toBeNull();
      expect(resource.source_url.startsWith("https://")).toBe(true);
    }
    expect(result.message).toMatch(/starting points/i);
  });
});
