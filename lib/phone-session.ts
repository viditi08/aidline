import { createHash } from "node:crypto";
import { emptyContext, type Resource, type SessionContext } from "@/lib/types";

/**
 * Short-lived, in-memory conversation state for calls and texts.
 * Keys are hashed so raw phone numbers are never held. Nothing is written to disk.
 * This works for one server process (local dev, a single container). On serverless
 * hosts with many instances, swap this for a shared store such as Redis.
 */
const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 2000;

interface Entry {
  context: SessionContext;
  expires: number;
}

const sessions = new Map<string, Entry>();

function keyFor(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function prune(now: number) {
  for (const [key, entry] of sessions) {
    if (entry.expires <= now) sessions.delete(key);
  }
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

export function loadSession(id: string, now = Date.now()): SessionContext {
  const entry = sessions.get(keyFor(id));
  if (!entry || entry.expires <= now) return emptyContext();
  return entry.context;
}

export function saveSession(id: string, context: SessionContext, now = Date.now()) {
  const key = keyFor(id);
  sessions.delete(key);
  sessions.set(key, { context, expires: now + TTL_MS });
  prune(now);
}

export function clearSession(id: string) {
  sessions.delete(keyFor(id));
}

/** Spoken summary for a phone call: names plus only the phone numbers the sources listed. */
export function spokenResources(resources: Resource[]): string {
  return resources
    .map((resource, index) => {
      const phone = resource.phone ? ` Their listed phone number is ${spellPhone(resource.phone)}.` : "";
      return `Option ${index + 1}: ${resource.name}.${phone} ${resource.action}`;
    })
    .join(" ");
}

function spellPhone(phone: string): string {
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return phone;
  const spaced = (part: string) => part.split("").join(" ");
  return `${spaced(digits.slice(0, 3))}, ${spaced(digits.slice(3, 6))}, ${spaced(digits.slice(6))}`;
}

const SMS_LIMIT = 1500;

/** Compact text for SMS. Only facts present on the resource are included. */
export function smsResources(resources: Resource[]): string {
  const blocks = resources.map((resource, index) => {
    const lines = [`${index + 1}. ${resource.name}`];
    if (resource.phone) lines.push(`Phone: ${resource.phone}`);
    if (resource.address) lines.push(`Address: ${resource.address}`);
    if (resource.hours) lines.push(`Hours: ${resource.hours}`);
    lines.push(resource.source_url);
    return lines.join("\n");
  });
  const footer = "Confirm hours and eligibility with the provider. AidLine can't decide eligibility or apply for you.";
  let text = "";
  for (const block of blocks) {
    const candidate = text ? `${text}\n\n${block}` : block;
    if (candidate.length + footer.length + 2 > SMS_LIMIT) break;
    text = candidate;
  }
  return text ? `${text}\n\n${footer}` : footer;
}
