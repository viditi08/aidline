import { AUDIENCE_LABEL, percent } from "@/lib/decision-labels";
import { VERIFICATION_LABEL, type Resource } from "@/lib/types";

export function resourcePlainText(resource: Resource): string {
  return [
    resource.name,
    resource.assistance_type,
    resource.address ? `Address: ${resource.address}` : "Address: not listed in the source",
    resource.hours ? `Hours: ${resource.hours}` : "Hours: not listed — confirm with the provider",
    resource.phone ? `Phone: ${resource.phone}` : "Phone: not listed in the source",
    resource.eligibility
      ? `Eligibility: ${resource.eligibility}`
      : "Eligibility: not stated. AidLine cannot decide whether you qualify.",
    resource.documents ? `Documents: ${resource.documents}` : "Documents: not listed in the source",
    `Next step: ${resource.action}`,
    `Source: ${resource.source_url}`,
    `Status: ${VERIFICATION_LABEL[resource.verification_status]}`,
    ...decisionLines(resource),
  ].join("\n");
}

function decisionLines(resource: Resource): string[] {
  const decision = resource.decision;
  if (!decision) return [];
  const parts = [
    decision.open_today != null ? `serving food ${decision.day} ${percent(decision.open_today)} likely` : null,
    decision.audience ? AUDIENCE_LABEL[decision.audience].toLowerCase() : null,
    decision.offers_food != null ? `gives free food ${percent(decision.offers_food)} likely` : null,
  ].filter(Boolean);
  return parts.length ? [`Parallel Decisions estimate: ${parts.join(", ")}`] : [];
}

export function summaryPlainText(resources: Resource[]): string {
  return resources.map(resourcePlainText).join("\n\n");
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
