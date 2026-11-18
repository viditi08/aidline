export type Category = "food";
export type Urgency = "today" | "soon" | "ongoing";
export const FOCUS_VALUES = [
  "general",
  "meals",
  "restaurants",
  "helpline",
  "families",
  "seniors",
  "hours",
  "eligibility",
  "delivery",
  "application",
] as const;
export type SearchFocus = (typeof FOCUS_VALUES)[number];
export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "needs_confirmation"
  | "fallback_directory";
export type SearchStatus = "ok" | "unavailable" | "outside_area" | "no_results";
export type AgentStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "searching"
  | "speaking"
  | "muted"
  | "error";

export type Audience = "anyone" | "specific_group" | "application_required";

/** Parallel Decisions estimates for one resource. Probabilities are 0 to 1. */
export interface ResourceDecision {
  offers_food: number | null;
  audience: Audience | null;
  audience_confidence: number | null;
  open_today: number | null;
  day: string;
  citations: { url: string; title: string | null }[];
  decision_id: string | null;
}

export interface Resource {
  id: string;
  name: string;
  description: string;
  assistance_type: string;
  address: string | null;
  phone: string | null;
  hours: string | null;
  eligibility: string | null;
  documents: string | null;
  action: string;
  source_url: string;
  verification_status: VerificationStatus;
  uncertainties: string;
  decision?: ResourceDecision | null;
}

export interface SearchInput {
  category: Category;
  zip_code: string;
  urgency?: Urgency | null;
  household_size?: number | null;
  focus?: SearchFocus;
}

export interface SearchResponse {
  category: Category;
  zip_code: string;
  urgency: Urgency | null;
  focus: SearchFocus;
  search_status: SearchStatus;
  message: string;
  resources: Resource[];
  searched_at: string;
}

export interface SessionContext {
  category: Category | null;
  zip: string | null;
  urgency: Urgency | null;
  householdSize: number | null;
  focus: SearchFocus;
  resources: Resource[];
}

export interface TranscriptLine {
  id: string;
  role: "user" | "agent";
  text: string;
}

export function emptyContext(): SessionContext {
  return {
    category: null,
    zip: null,
    urgency: null,
    householdSize: null,
    focus: "general",
    resources: [],
  };
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: "Details found in source",
  partially_verified: "Partially verified",
  needs_confirmation: "Confirm with provider",
  fallback_directory: "Official starting point",
};
