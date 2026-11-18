export type Category = "food" | "utility";
export type Urgency = "today" | "soon" | "ongoing" | "emergency";
export type SearchFocus = "general" | "hours" | "eligibility" | "delivery" | "application";
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
}

export interface SearchInput {
  category: Category;
  zip_code: string;
  urgency?: Urgency | null;
  household_size?: number | null;
  utility_provider?: string | null;
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
  utilityProvider: string | null;
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
    utilityProvider: null,
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
