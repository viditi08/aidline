export const SAN_FRANCISCO_ZIPS = new Set([
  "94102",
  "94103",
  "94104",
  "94105",
  "94107",
  "94108",
  "94109",
  "94110",
  "94111",
  "94112",
  "94114",
  "94115",
  "94116",
  "94117",
  "94118",
  "94121",
  "94122",
  "94123",
  "94124",
  "94127",
  "94129",
  "94130",
  "94131",
  "94132",
  "94133",
  "94134",
  "94158",
]);

export function isSanFranciscoZip(zip: string): boolean {
  return SAN_FRANCISCO_ZIPS.has(zip);
}

export function extractZip(text: string): string | null {
  const match = text.match(/\b(94\d{3})(?:-\d{4})?\b/);
  return match?.[1] ?? null;
}
