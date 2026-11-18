"use client";

import { useEffect, useRef, useState } from "react";
import { ResourcePanel } from "@/components/resource-panel";
import { Waveform } from "@/components/waveform";
import { VoiceSession } from "@/lib/voice-session";
import {
  emptyContext,
  type AgentStatus,
  type Resource,
  type SearchInput,
  type SearchResponse,
  type SessionContext,
  type TranscriptLine,
} from "@/lib/types";

const PROMPTS = ["I can't afford food right now.", "Where can I get a free meal today?", "Who can I call for food help?"];

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  searching: "Searching",
  speaking: "Speaking",
  muted: "Muted",
  error: "Needs attention",
};

interface Capabilities {
  voice: boolean;
  search: boolean;
}

interface TurnResponse {
  reply: string;
  shouldSearch: boolean;
  searchInput: SearchInput | null;
  context: SessionContext;
  error?: string;
}

function createLine(role: TranscriptLine["role"], text: string): TranscriptLine {
  return { id: crypto.randomUUID(), role, text };
}

export function AidLineApp() {
  const [phase, setPhase] = useState<"welcome" | "conversation">("welcome");
  const [mode, setMode] = useState<"voice" | "type">("type");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [messages, setMessages] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState("");
  const [context, setContext] = useState<SessionContext>(emptyContext());
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const contextRef = useRef(context);
  const voiceRef = useRef<VoiceSession | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  contextRef.current = context;

  useEffect(() => {
    void fetch("/api/status")
      .then((response) => response.json())
      .then((data: Capabilities) => setCapabilities(data))
      .catch(() => setCapabilities({ voice: false, search: false }));
    return () => {
      void voiceRef.current?.end();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, partial, searching, resources]);

  async function submit(text: string, options?: { echoUser?: boolean }) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNotice(null);
    setDraft("");
    if (options?.echoUser !== false) setMessages((current) => [...current, createLine("user", trimmed)]);
    setStatus("thinking");
    try {
      const turnResponse = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, context: contextRef.current }),
      });
      const plan = (await turnResponse.json()) as TurnResponse;
      if (!turnResponse.ok) throw new Error(plan.error || "AidLine could not continue that conversation.");
      contextRef.current = plan.context;
      setContext(plan.context);
      setMessages((current) => [...current, createLine("agent", plan.reply)]);
      if (plan.shouldSearch && plan.searchInput) {
        setSearching(true);
        setStatus("searching");
        const searchResponse = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(plan.searchInput),
        });
        const result = (await searchResponse.json()) as SearchResponse & { error?: string };
        if (!searchResponse.ok) throw new Error(result.message || result.error || "Search failed.");
        const nextContext = { ...plan.context, resources: result.resources ?? [] };
        contextRef.current = nextContext;
        setContext(nextContext);
        setResources(result.resources ?? []);
        setMessages((current) => [...current, createLine("agent", result.message)]);
      }
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setNotice(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setSearching(false);
      setBusy(false);
    }
  }

  async function startVoice(seed?: string) {
    await voiceRef.current?.end();
    const session = new VoiceSession(
      {
        onStatus: setStatus,
        onUserText: (text, final) => {
          if (final) {
            setPartial("");
            setMessages((current) => [...current, createLine("user", text)]);
          } else {
            setPartial(text);
          }
        },
        onAgentText: (text) => setMessages((current) => [...current, createLine("agent", text)]),
        onSearching: setSearching,
        onSearchResult: (result) => {
          if (result.resources?.length) setResources(result.resources);
          if (result.search_status && result.search_status !== "ok" && result.message) setNotice(result.message);
          if (result.search_status === "ok") setNotice(null);
        },
        onContext: (patch) => {
          setContext((current) => {
            const next = { ...current, ...patch };
            contextRef.current = next;
            return next;
          });
        },
        onError: (message) => {
          setStatus("error");
          setNotice(message);
        },
      },
      seed,
    );
    voiceRef.current = session;
    setMode("voice");
    setStatus("connecting");
    try {
      await session.start();
    } catch (error) {
      await session.end();
      if (voiceRef.current === session) voiceRef.current = null;
      setMode("type");
      setStatus("error");
      setNotice(error instanceof Error ? error.message : "Microphone or voice startup failed. You can type instead.");
      if (seed) await submit(seed, { echoUser: false });
    }
  }

  function begin(kind: "voice" | "type", seed?: string) {
    const fresh = emptyContext();
    contextRef.current = fresh;
    setContext(fresh);
    setResources([]);
    setSelectedId(null);
    setNotice(null);
    setPartial("");
    setMuted(false);
    setPhase("conversation");
    setMessages(seed ? [createLine("user", seed)] : []);
    if (kind === "voice" && capabilities?.voice) {
      void startVoice(seed);
      return;
    }
    setMode("type");
    setStatus("idle");
    if (seed) void submit(seed, { echoUser: false });
  }

  async function endConversation() {
    await voiceRef.current?.end();
    voiceRef.current = null;
    const fresh = emptyContext();
    contextRef.current = fresh;
    setContext(fresh);
    setMessages([]);
    setResources([]);
    setPartial("");
    setSelectedId(null);
    setSearching(false);
    setNotice("Conversation ended. Nothing was saved.");
    setPhase("welcome");
    setStatus("idle");
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    voiceRef.current?.setMuted(next);
    setStatus(next ? "muted" : "listening");
  }

  const sessionBits = [
    context.category === "food" ? "Food" : null,
    context.zip,
    context.urgency,
  ].filter(Boolean);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal">AidLine</p>
          <p className="font-display text-lg">San Francisco</p>
        </div>
        <p className="rounded-full border border-line bg-card px-3 py-1 text-sm">Coverage: San Francisco only</p>
      </header>

      {phase === "welcome" ? (
        <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-12 text-center">
          <p className="rounded-full bg-teal/10 px-3 py-1 text-sm font-semibold text-teal-deep">Free food help, by voice</p>
          <h1 className="mt-6 font-display text-6xl leading-none text-ink sm:text-7xl">Need help? Just ask.</h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-ink/80">Find free meals, groceries, and food help lines in San Francisco.</p>
          <button
            type="button"
            className="mt-10 grid h-28 w-28 place-items-center rounded-full bg-teal text-white shadow-[0_16px_40px_rgba(12,92,86,0.28)] disabled:opacity-50"
            onClick={() => begin(capabilities?.voice ? "voice" : "type")}
            disabled={!capabilities}
            aria-label="Start voice conversation"
          >
            <MicIcon />
          </button>
          <button
            type="button"
            className="mt-5 rounded-full bg-ink px-5 py-3 font-semibold text-paper disabled:opacity-50"
            disabled={!capabilities}
            onClick={() => begin(capabilities?.voice ? "voice" : "type")}
          >
            Start Conversation
          </button>
          <div className="mt-6 flex flex-col flex-wrap justify-center gap-2 sm:flex-row">
            {PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-full border border-line bg-card px-4 py-2 text-left text-sm font-semibold"
                onClick={() => begin(capabilities?.voice ? "voice" : "type", prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          {notice ? <p className="mt-4 text-sm text-clay">{notice}</p> : null}
        </section>
      ) : (
        <section className="mt-6 grid flex-1 gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex min-h-[70dvh] flex-col rounded-[2rem] border border-line bg-card/80 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-teal px-3 py-1 text-sm font-semibold text-white" aria-live="polite">
                  {STATUS_LABEL[status]}
                </span>
                {sessionBits.length > 0 ? <span className="text-sm text-ink/70">{sessionBits.join(" · ")}</span> : null}
              </div>
              <div className="flex gap-2">
                {mode === "voice" ? (
                  <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold" onClick={toggleMute}>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                ) : null}
                <button type="button" className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold" onClick={() => void endConversation()}>
                  End Conversation
                </button>
              </div>
            </div>
            <Waveform active={status === "listening" || status === "speaking"} />
            {searching ? (
              <p className="rounded-2xl bg-clay/10 px-3 py-2 text-sm font-semibold text-clay" role="status">
                Searching trusted assistance resources…
              </p>
            ) : null}
            <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
              {messages.map((message) => (
                <p
                  key={message.id}
                  className={`max-w-[95%] rounded-3xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user" ? "ml-auto bg-teal text-white" : "bg-paper text-ink"
                  }`}
                >
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">
                    {message.role === "user" ? "You" : "AidLine"}
                  </span>
                  {message.text}
                </p>
              ))}
              {partial ? <p className="ml-auto max-w-[95%] rounded-3xl bg-teal/15 px-4 py-3 text-sm italic">{partial}</p> : null}
              <div ref={bottomRef} />
            </div>
            {notice ? <p className="mt-3 text-sm text-clay">{notice}</p> : null}
            {mode === "type" ? (
              <form
                className="mt-4 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(draft);
                }}
              >
                <label className="sr-only" htmlFor="message">
                  Message AidLine
                </label>
                <input
                  id="message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Describe what you need"
                  className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-3 outline-none ring-teal focus:ring-2"
                />
                <button type="submit" disabled={busy || !draft.trim()} className="rounded-full bg-ink px-4 py-3 font-semibold text-paper disabled:opacity-40">
                  Send
                </button>
              </form>
            ) : (
              <p className="mt-4 text-center text-sm text-ink/70">Speak naturally. You can interrupt AidLine while it is talking.</p>
            )}
          </div>
          <ResourcePanel
            resources={resources}
            selectedId={selectedId}
            onSelect={setSelectedId}
            askingEnabled={mode === "type" && resources.length > 0}
            onAsk={(text) => void submit(text)}
          />
        </section>
      )}
    </main>
  );
}

function MicIcon() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
