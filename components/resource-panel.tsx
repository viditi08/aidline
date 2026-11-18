"use client";

import { useState } from "react";
import { resourcePlainText, summaryPlainText, telHref } from "@/lib/format";
import { VERIFICATION_LABEL, type Resource } from "@/lib/types";

function Badge({ resource }: { resource: Resource }) {
  const tone =
    resource.verification_status === "verified"
      ? "bg-moss/10 text-moss"
      : resource.verification_status === "fallback_directory"
        ? "bg-ink/5 text-ink"
        : "bg-amber/10 text-amber";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {VERIFICATION_LABEL[resource.verification_status]}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <p className="text-sm leading-6">
      <span className="font-semibold">{label}: </span>
      <span>{value ?? "Not listed in the source. Confirm with the provider."}</span>
    </p>
  );
}

export function ResourcePanel({
  resources,
  selectedId,
  onSelect,
  onAsk,
  askingEnabled,
}: {
  resources: Resource[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAsk: (text: string) => void;
  askingEnabled: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const selected = resources.find((resource) => resource.id === selectedId) ?? null;

  async function copy(id: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1600);
  }

  if (resources.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Assistance resources">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-teal-deep">Places to start</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink/75">
            Up to three options. Confirm hours, eligibility, and availability before you go. AidLine does not submit applications.
          </p>
        </div>
        <button
          type="button"
          className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold"
          onClick={() => copy("all", summaryPlainText(resources))}
        >
          {copied === "all" ? "Copied" : "Copy summary"}
        </button>
      </div>

      <div className="grid gap-3">
        {resources.map((resource) => (
          <article key={resource.id} className="rounded-3xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(26,35,50,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-clay">{resource.assistance_type}</p>
                <h3 className="mt-1 font-display text-2xl leading-tight">{resource.name}</h3>
              </div>
              <Badge resource={resource} />
            </div>
            <p className="mt-3 text-sm leading-6 text-ink/80">{resource.description}</p>
            <div className="mt-4 space-y-1">
              <Fact label="Address" value={resource.address} />
              <Fact label="Hours" value={resource.hours} />
              <p className="text-sm leading-6">
                <span className="font-semibold">Phone: </span>
                {resource.phone ? (
                  <a className="underline decoration-teal/40" href={telHref(resource.phone)}>
                    {resource.phone}
                  </a>
                ) : (
                  "Not listed in the source. Confirm with the provider."
                )}
              </p>
              <Fact label="Eligibility" value={resource.eligibility} />
            </div>
            <p className="mt-3 text-sm leading-6">
              <span className="font-semibold">Next step: </span>
              {resource.action}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="rounded-full bg-teal px-3 py-1.5 text-sm font-semibold text-white" onClick={() => onSelect(resource.id)}>
                View details
              </button>
              <a
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold"
                href={resource.source_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open website
              </a>
              <button
                type="button"
                className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold"
                onClick={() => copy(resource.id, resourcePlainText(resource))}
              >
                {copied === resource.id ? "Copied" : "Copy information"}
              </button>
            </div>
          </article>
        ))}
      </div>

      {askingEnabled ? (
        <div className="flex flex-wrap gap-2">
          {["Are these places open today?", "What if I can't get there?", "Do I need to qualify?"].map((prompt) => (
            <button key={prompt} type="button" className="rounded-full bg-teal/10 px-3 py-1.5 text-sm font-semibold text-teal-deep" onClick={() => onAsk(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <aside className="rounded-3xl border border-teal/20 bg-teal-deep p-5 text-paper" aria-label="Resource details">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-3xl leading-tight">{selected.name}</h3>
            <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-sm" onClick={() => onSelect(null)}>
              Close
            </button>
          </div>
          <dl className="mt-4 space-y-3 text-sm leading-6">
            <div>
              <dt className="font-semibold text-white">What it offers</dt>
              <dd>{selected.description}</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Who it may help</dt>
              <dd>{selected.eligibility ?? "Not stated in the source. AidLine cannot decide whether you qualify."}</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">How to access assistance</dt>
              <dd>{selected.action}</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Documents that may be required</dt>
              <dd>{selected.documents ?? "The source did not list required documents."}</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">What is still uncertain</dt>
              <dd>{selected.uncertainties}</dd>
            </div>
            <div>
              <dt className="font-semibold text-white">Source</dt>
              <dd>
                <a className="underline" href={selected.source_url} target="_blank" rel="noreferrer noopener">
                  {selected.source_url}
                </a>
              </dd>
            </div>
          </dl>
        </aside>
      ) : null}
    </section>
  );
}
