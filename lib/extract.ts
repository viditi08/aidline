const PHONE =
  /(?:^|[^\d])((?:\+1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4})(?!\d)/;

const ADDRESS =
  /\b\d{1,5}\s+[A-Za-z0-9][^,\n]{2,60}?\s(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Way|Lane|Ln)\b\.?(?:,\s*(?:San Francisco|SF)(?:,\s*CA)?)?/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function matchingSentence(text: string, pattern: RegExp, max = 280): string | null {
  const hit = sentences(text).find((part) => pattern.test(part) && part.length <= max);
  return hit ?? null;
}

export function extractPhone(text: string): string | null {
  const match = text.match(PHONE);
  return match?.[1]?.trim() ?? null;
}

export function extractHours(text: string): string | null {
  const match = text.match(
    /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|hours)[^.\n]{0,60}?\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm)(?:\s*(?:to|–|-|through)\s*\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm))?/i,
  );
  if (!match) return null;
  const value = match[0].replace(/\s+/g, " ").trim();
  return value.length <= 220 ? value : null;
}

export function extractAddress(text: string): string | null {
  const match = text.match(ADDRESS);
  if (!match) return null;
  const address = match[0].replace(/\s+/g, " ").trim();
  return address.length <= 140 ? address : null;
}

export function extractEligibility(text: string): string | null {
  return matchingSentence(text, /\b(eligib|qualif|income (at|below|under|limit)|household income)\b/i);
}

export function extractDocuments(text: string): string | null {
  return matchingSentence(
    text,
    /\b(bring|photo id|identification|proof of|documents? required|must provide)\b/i,
  );
}

export function cleanTitle(title: string | null | undefined, url: string): string {
  const fallback = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "Assistance resource";
    }
  })();
  if (!title?.trim()) return fallback;
  const cut = title.split(/\s+[|–—-]\s+/)[0]?.trim() || title.trim();
  return cut.slice(0, 120);
}

export function clip(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}
