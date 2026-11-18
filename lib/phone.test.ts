import { describe, expect, it } from "vitest";
import { phoneAgentConfig, phoneSummary, phoneToolResult, secretMatches } from "@/lib/phone";
import type { SearchResponse } from "@/lib/types";

describe("phone tool (AssemblyAI HTTP tool)", () => {
  it("answers a helpline request with official numbers on one line", async () => {
    const text = await phoneToolResult({ zip_code: "94103", focus: "helpline" });
    expect(text).toContain("415-282-1900");
    expect(text).toContain("2-1-1");
    expect(text).not.toContain("\n");
    expect(Buffer.byteLength(text)).toBeLessThan(8 * 1024);
  });

  it("forces the food category even if the model sends something else", async () => {
    const text = await phoneToolResult({ category: "utility", zip_code: "94103", focus: "helpline" });
    expect(text).toContain("2-1-1");
  });

  it("asks for a San Francisco ZIP code instead of searching elsewhere", async () => {
    expect(await phoneToolResult({ zip_code: "10001" })).toMatch(/only covers San Francisco/);
    expect(await phoneToolResult({})).toMatch(/ZIP code/);
  });

  it("checks the shared secret", () => {
    expect(secretMatches("s3cret", null)).toBe(false);
    expect(secretMatches("s3cret", "wrong!")).toBe(false);
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
  });
});

describe("phone summary", () => {
  it("includes only facts present on each resource and the Decisions estimate", () => {
    const result: SearchResponse = {
      category: "food",
      zip_code: "94102",
      urgency: "today",
      focus: "meals",
      search_status: "ok",
      message: "I found 1 possible option.",
      searched_at: "2026-11-17T00:00:00Z",
      resources: [
        {
          id: "r1",
          name: "Community Meals",
          description: "Free meals",
          assistance_type: "Free meals",
          address: null,
          phone: "(415) 355-6700",
          hours: null,
          eligibility: null,
          documents: null,
          action: "Call ahead.",
          source_url: "https://www.sfhsa.org/x",
          verification_status: "verified",
          uncertainties: "Not confirmed.",
          decision: { offers_food: 0.98, audience: "specific_group", audience_confidence: 0.9, open_today: 0.82, day: "Tuesday", citations: [], decision_id: null },
        },
      ],
    };
    const text = phoneSummary(result);
    expect(text).toContain("(415) 355-6700");
    expect(text).toContain("serving food Tuesday: 82%");
    expect(text).not.toContain("Listed address");
  });
});

describe("AssemblyAI phone agent", () => {
  it("defines search_assistance as an HTTP tool with the secret header", () => {
    const config = phoneAgentConfig("https://example.trycloudflare.com/api/phone-tool", "s3cret");
    const tool = config.tools[0]!;
    expect(tool.name).toBe("search_assistance");
    expect(tool.http).toEqual({
      url: "https://example.trycloudflare.com/api/phone-tool",
      http_method: "POST",
      headers: [{ name: "x-aidline-secret", value: "s3cret" }],
    });
    expect(config.voice).toEqual({ voice_id: "alba" });
    expect(config.system_prompt).toMatch(/phone call/);
    expect(config.greeting).toMatch(/AidLine/);
  });
});
