import { isSanFranciscoZip } from "@/lib/sf";
import {
  emptyContext,
  FOCUS_VALUES,
  type Category,
  type Resource,
  type SearchFocus,
  type SearchInput,
  type SessionContext,
  type Urgency,
  type VerificationStatus,
} from "@/lib/types";

const CATEGORIES = new Set<Category>(["food"]);
const URGENCIES = new Set<Urgency>(["today", "soon", "ongoing"]);
const FOCUSES = new Set<SearchFocus>(FOCUS_VALUES);
const VERIFICATION = new Set<VerificationStatus>([
  "verified",
  "partially_verified",
  "needs_confirmation",
  "fallback_directory",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseSearchInput(body: unknown): SearchInput | { error: string } {
  const record = asRecord(body);
  if (!record) return { error: "Search input must be an object." };

  const category = record.category;
  if (category !== "food") {
    return { error: "category must be food." };
  }

  const zip = typeof record.zip_code === "string" ? record.zip_code.trim() : "";
  if (!/^\d{5}$/.test(zip)) return { error: "zip_code must be a five-digit ZIP code." };
  if (!isSanFranciscoZip(zip)) {
    return { error: "AidLine currently covers San Francisco ZIP codes only." };
  }

  const input: SearchInput = { category, zip_code: zip };

  if (record.urgency != null) {
    if (typeof record.urgency !== "string" || !URGENCIES.has(record.urgency as Urgency)) {
      return { error: "urgency is not a supported value." };
    }
    input.urgency = record.urgency as Urgency;
  }

  if (record.focus != null) {
    if (typeof record.focus !== "string" || !FOCUSES.has(record.focus as SearchFocus)) {
      return { error: "focus is not a supported value." };
    }
    input.focus = record.focus as SearchFocus;
  }

  if (record.household_size != null && record.household_size !== "") {
    const size = Number(record.household_size);
    if (!Number.isInteger(size) || size < 1 || size > 12) {
      return { error: "household_size must be a whole number from 1 to 12." };
    }
    input.household_size = size;
  }


  return input;
}

function clipString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function parseResource(value: unknown): Resource | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = clipString(record.name, 160);
  const source = clipString(record.source_url, 500);
  const action = clipString(record.action, 300);
  const description = clipString(record.description, 500);
  const assistance = clipString(record.assistance_type, 80);
  const uncertainties = clipString(record.uncertainties, 800);
  const status = record.verification_status;
  if (!name || !source || !action || !description || !assistance || !uncertainties) return null;
  if (typeof status !== "string" || !VERIFICATION.has(status as VerificationStatus)) return null;
  if (!/^https:\/\//i.test(source)) return null;
  return {
    id: clipString(record.id, 80) ?? "resource",
    name,
    description,
    assistance_type: assistance,
    address: clipString(record.address, 180),
    phone: clipString(record.phone, 40),
    hours: clipString(record.hours, 240),
    eligibility: clipString(record.eligibility, 300),
    documents: clipString(record.documents, 300),
    action,
    source_url: source,
    verification_status: status as VerificationStatus,
    uncertainties,
  };
}

export function sanitizeContext(value: unknown): SessionContext {
  const context = emptyContext();
  const record = asRecord(value);
  if (!record) return context;

  if (typeof record.category === "string" && CATEGORIES.has(record.category as Category)) {
    context.category = record.category as Category;
  }
  if (typeof record.zip === "string" && isSanFranciscoZip(record.zip)) context.zip = record.zip;
  if (typeof record.urgency === "string" && URGENCIES.has(record.urgency as Urgency)) {
    context.urgency = record.urgency as Urgency;
  }
  if (typeof record.focus === "string" && FOCUSES.has(record.focus as SearchFocus)) {
    context.focus = record.focus as SearchFocus;
  }
  if (typeof record.householdSize === "number" && record.householdSize >= 1 && record.householdSize <= 12) {
    context.householdSize = record.householdSize;
  }
  if (Array.isArray(record.resources)) {
    context.resources = record.resources.map(parseResource).filter((item): item is Resource => item !== null).slice(0, 3);
  }
  return context;
}
