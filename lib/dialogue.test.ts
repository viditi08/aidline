import { describe, expect, it } from "vitest";
import { nextTurn } from "@/lib/dialogue";
import { emptyContext, type SessionContext } from "@/lib/types";

function say(context: SessionContext, text: string) {
  return nextTurn(context, text);
}

describe("AidLine conversation", () => {
  it("asks for a ZIP code when someone needs food today", () => {
    const turn = say(emptyContext(), "I need food for my kids today.");
    expect(turn.shouldSearch).toBe(false);
    expect(turn.context.category).toBe("food");
    expect(turn.context.urgency).toBe("today");
    expect(turn.reply).toMatch(/ZIP code/i);
  });

  it("searches after the ZIP code is known for same-day food", () => {
    const first = say(emptyContext(), "I need food for my kids today.");
    const second = say(first.context, "94103");
    expect(second.shouldSearch).toBe(true);
    expect(second.searchInput).toMatchObject({
      category: "food",
      zip_code: "94103",
      urgency: "today",
      focus: "general",
    });
    expect(second.reply).toMatch(/today/i);
  });

  it("treats grocery assistance after a job loss as ongoing food help", () => {
    const turn = say(emptyContext(), "I lost my job and need grocery assistance.");
    expect(turn.context.category).toBe("food");
    expect(turn.context.urgency).toBe("ongoing");
    expect(turn.shouldSearch).toBe(false);
    const next = say(turn.context, "94110");
    expect(next.shouldSearch).toBe(true);
    expect(next.searchInput?.urgency).toBe("ongoing");
  });

  it("treats a looming shutoff as urgent utility help and asks who the provider is", () => {
    const turn = say(emptyContext(), "My electricity might get cut off tomorrow.");
    expect(turn.context.category).toBe("utility");
    expect(turn.context.urgency).toBe("emergency");
    expect(turn.shouldSearch).toBe(false);
    expect(turn.reply).toMatch(/utility|company|bill/i);
    const provider = say(turn.context, "PG&E");
    expect(provider.context.utilityProvider).toBe("PG&E");
    expect(provider.reply).toMatch(/ZIP code/i);
    const zip = say(provider.context, "94103");
    expect(zip.shouldSearch).toBe(true);
    expect(zip.searchInput).toMatchObject({ category: "utility", zip_code: "94103", urgency: "emergency" });
  });

  it("looks up eligibility without deciding that someone qualifies", () => {
    const turn = say(emptyContext(), "I don't know if I qualify for food assistance.");
    expect(turn.context.focus).toBe("eligibility");
    expect(turn.reply).toMatch(/ZIP code/i);
    expect(turn.reply).not.toMatch(/you qualify/i);
    const next = say(turn.context, "94102");
    expect(next.shouldSearch).toBe(true);
    expect(next.searchInput?.focus).toBe("eligibility");
    expect(next.reply).toMatch(/can't decide whether you qualify/i);
  });

  it("asks for context before answering whether places are open", () => {
    const turn = say(emptyContext(), "Are these places open today?");
    expect(turn.shouldSearch).toBe(false);
    expect(turn.reply).toMatch(/ZIP code/i);
  });

  it("checks hours again without inventing that a place is open", () => {
    const seeded: SessionContext = {
      ...emptyContext(),
      category: "food",
      zip: "94103",
      urgency: "today",
      resources: [],
    };
    const turn = say(seeded, "Are these places open today?");
    expect(turn.shouldSearch).toBe(true);
    expect(turn.searchInput?.focus).toBe("hours");
    expect(turn.reply).toMatch(/won't guess/i);
  });

  it("checks delivery options when the person cannot get there", () => {
    const seeded: SessionContext = {
      ...emptyContext(),
      category: "food",
      zip: "94103",
      urgency: "today",
    };
    const turn = say(seeded, "What if I can't get there?");
    expect(turn.shouldSearch).toBe(true);
    expect(turn.searchInput?.focus).toBe("delivery");
  });

  it("refuses sensitive financial identifiers", () => {
    const turn = say(emptyContext(), "My social security number is 123-45-6789");
    expect(turn.shouldSearch).toBe(false);
    expect(turn.reply).toMatch(/don't share/i);
    expect(turn.context.zip).toBeNull();
  });

  it("stays inside San Francisco", () => {
    const turn = say(emptyContext(), "I need food in 94601");
    expect(turn.shouldSearch).toBe(false);
    expect(turn.reply).toMatch(/San Francisco/);
    expect(turn.context.zip).toBeNull();
  });

  it("accepts an unknown utility provider and still collects the ZIP code", () => {
    const first = say(emptyContext(), "My power might be shut off tomorrow.");
    const second = say(first.context, "I don't know");
    expect(second.context.utilityProvider).toBe("unknown");
    expect(second.reply).toMatch(/ZIP code/i);
  });
});
