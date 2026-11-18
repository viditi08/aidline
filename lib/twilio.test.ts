import { describe, expect, it, vi } from "vitest";
import { escapeXml, expectedSignature, readTwilioWebhook, signatureMatches, signedUrl } from "@/lib/twilio";
import { loadSession, saveSession, smsResources } from "@/lib/phone-session";
import { isGoodbye, smsTurn, wantsText } from "@/lib/phone-agent";
import { emptyContext, type Resource } from "@/lib/types";

// Example from Twilio's security docs.
const TOKEN = "12345";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };

describe("twilio signatures", () => {
  it("matches Twilio's documented example", () => {
    expect(expectedSignature(TOKEN, URL_, PARAMS)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(signatureMatches(TOKEN, URL_, PARAMS, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(true);
  });

  it("rejects missing or wrong signatures", () => {
    expect(signatureMatches(TOKEN, URL_, PARAMS, null)).toBe(false);
    expect(signatureMatches(TOKEN, URL_, { ...PARAMS, Digits: "9" }, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=")).toBe(false);
  });

  it("uses the public base URL when configured", () => {
    const request = new Request("http://localhost:3000/api/twilio/sms?x=1");
    expect(signedUrl(request, { TWILIO_WEBHOOK_BASE_URL: "https://abc.ngrok.app" } as unknown as NodeJS.ProcessEnv)).toBe(
      "https://abc.ngrok.app/api/twilio/sms?x=1",
    );
  });

  it("rejects unsigned webhooks when configured", async () => {
    const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv;
    const request = new Request("https://x.test/api/twilio/sms", { method: "POST", body: "Body=hi&From=%2B1555" });
    const result = await readTwilioWebhook(request, env);
    expect(result instanceof Response && result.status).toBe(403);
  });

  it("escapes XML", () => {
    expect(escapeXml(`PG&E <"it's">`)).toBe("PG&amp;E &lt;&quot;it&apos;s&quot;&gt;");
  });
});

const resource: Resource = {
  id: "r1",
  name: "SF-Marin Food Bank",
  description: "Food pantry finder",
  assistance_type: "Food pantry",
  address: null,
  phone: "415-282-1900",
  hours: null,
  eligibility: null,
  documents: null,
  action: "Use the pantry finder.",
  source_url: "https://www.sfmfoodbank.org/find-food/",
  verification_status: "partially_verified",
  uncertainties: "Hours not listed.",
};

describe("phone agent", () => {
  it("keeps per-caller context", () => {
    const context = { ...emptyContext(), zip: "94103" };
    saveSession("sms:+15550001", context);
    expect(loadSession("sms:+15550001").zip).toBe("94103");
    expect(loadSession("sms:+15550002").zip).toBeNull();
  });

  it("only texts facts the source listed", () => {
    const text = smsResources([resource]);
    expect(text).toContain("Phone: 415-282-1900");
    expect(text).not.toContain("Hours:");
    expect(text.length).toBeLessThan(1600);
  });

  it("detects goodbye and text-me requests", () => {
    expect(isGoodbye("bye")).toBe(true);
    expect(isGoodbye("I need food")).toBe(false);
    expect(wantsText("can you text me those")).toBe(true);
    expect(wantsText("I need food")).toBe(false);
  });

  it("asks for a ZIP code over SMS before searching", async () => {
    const { replies, context } = await smsTurn(emptyContext(), "I need food for my kids today");
    expect(context.category).toBe("food");
    expect(replies[0]).toMatch(/ZIP/);
  });

  it("searches once it has category and ZIP", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "");
    const first = await smsTurn(emptyContext(), "I need food for my kids today");
    const second = await smsTurn(first.context, "94103");
    expect(second.replies).toHaveLength(2);
    expect(second.context.resources.length).toBeGreaterThan(0);
    vi.unstubAllEnvs();
  });
});
