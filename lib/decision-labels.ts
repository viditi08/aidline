import type { Audience } from "@/lib/types";

/** Display helpers for Parallel Decisions results. Safe to use in the browser. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export const AUDIENCE_LABEL: Record<Audience, string> = {
  anyone: "Open to anyone",
  specific_group: "For a specific group",
  application_required: "Apply first",
};
