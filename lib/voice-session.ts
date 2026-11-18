import { FOCUS_VALUES, type AgentStatus, type SearchFocus, type SearchResponse, type SessionContext } from "@/lib/types";

type ServerEvent = {
  type: string;
  text?: string;
  data?: string;
  call_id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  status?: string;
  message?: string;
  error?: string | { message?: string };
};

export interface VoiceHandlers {
  onStatus: (status: AgentStatus) => void;
  onUserText: (text: string, final: boolean) => void;
  onAgentText: (text: string) => void;
  onSearching: (active: boolean) => void;
  onSearchResult: (result: SearchResponse) => void;
  onContext: (patch: Partial<SessionContext>) => void;
  onError: (message: string) => void;
}

interface PendingTool {
  ready: boolean;
  result?: unknown;
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function errorText(event: ServerEvent): string {
  if (typeof event.error === "string") return event.error;
  if (event.error && typeof event.error.message === "string") return event.error.message;
  if (event.message) return event.message;
  return "The voice session hit an error.";
}

class PcmPlayer {
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor(private context: AudioContext) {}

  enqueue(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const samples = Math.floor(bytes.byteLength / 2);
    if (samples === 0) return;
    const audio = new Float32Array(samples);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < samples; index += 1) audio[index] = view.getInt16(index * 2, true) / 32768;
    const buffer = this.context.createBuffer(1, samples, 24000);
    buffer.copyToChannel(audio, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const now = this.context.currentTime;
    if (this.nextTime < now + 0.05) this.nextTime = now + 0.05;
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
    };
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The buffer may already have finished.
      }
    }
    this.sources = [];
    this.nextTime = 0;
  }
}

export class VoiceSession {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private player: PcmPlayer | null = null;
  private muted = false;
  private ready = false;
  private closed = false;
  private lastEvent: string | null = null;
  private pending = new Map<string, PendingTool>();

  constructor(
    private handlers: VoiceHandlers,
    private seed?: string,
  ) {}

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  async start() {
    this.handlers.onStatus("connecting");
    // Ask for the microphone first, while we still have the click that started this,
    // so a denial is reported here instead of crashing inside a socket handler.
    try {
      await this.startMicrophone();
    } catch (error) {
      await this.end();
      throw new Error(microphoneErrorText(error));
    }
    const tokenResponse = await fetch("/api/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seeded: Boolean(this.seed) }),
    });
    const tokenPayload = (await tokenResponse.json()) as { token?: string; session?: unknown; error?: string };
    if (!tokenResponse.ok || !tokenPayload.token || !tokenPayload.session) {
      throw new Error(tokenPayload.error || "AidLine could not start a voice session.");
    }

    const url = new URL("wss://agents.assemblyai.com/v1/ws");
    url.searchParams.set("token", tokenPayload.token);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      void this.onMessage(event);
    });
    socket.addEventListener("close", () => {
      if (!this.closed) this.handlers.onError("The voice session ended.");
    });

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The voice service took too long to connect.")), 12000);
      socket.addEventListener("open", () => {
        window.clearTimeout(timer);
        socket.send(JSON.stringify({ type: "session.update", session: tokenPayload.session }));
        resolve();
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timer);
        reject(new Error("The voice connection failed."));
      });
    });
  }

  async end() {
    this.closed = true;
    this.ready = false;
    try {
      this.socket?.send(JSON.stringify({ type: "session.end" }));
    } catch {
      // The socket may already be closed.
    }
    this.socket?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.player?.stop();
    await this.audioContext?.close().catch(() => undefined);
  }

  private async onMessage(event: MessageEvent) {
    const raw = typeof event.data === "string" ? event.data : await event.data.text();
    const message = JSON.parse(raw) as ServerEvent;

    if (message.type === "session.ready") {
      this.ready = true;
      this.handlers.onStatus(this.muted ? "muted" : "listening");
      if (this.seed) {
        const spoken = this.seed.replace(/"/g, "'");
        this.socket?.send(
          JSON.stringify({
            type: "reply.create",
            instructions: `The user just said: "${spoken}". Treat that as their first message. Do not give a long greeting. Ask only for the next missing essential detail, or call search_assistance if you already have category and ZIP code.`,
          }),
        );
      }
      return;
    }

    if (message.type === "session.error") {
      this.handlers.onError(errorText(message));
      this.handlers.onStatus("error");
      return;
    }

    if (message.type === "input.speech.started") {
      this.player?.stop();
      this.lastEvent = "input.speech.started";
      if (!this.muted) this.handlers.onStatus("listening");
      return;
    }

    if (message.type === "transcript.user.delta" && message.text) {
      this.handlers.onUserText(message.text, false);
      return;
    }

    if (message.type === "transcript.user" && message.text) {
      this.handlers.onUserText(message.text, true);
      return;
    }

    if (message.type === "reply.started") {
      this.lastEvent = "reply.started";
      if (this.pending.size === 0) this.handlers.onStatus("thinking");
      return;
    }

    if (message.type === "reply.audio" && message.data) {
      this.handlers.onStatus("speaking");
      this.player?.enqueue(message.data);
      return;
    }

    if (message.type === "transcript.agent" && message.text) {
      this.handlers.onAgentText(message.text);
      return;
    }

    if (message.type === "tool.call" && message.call_id && message.name) {
      this.pending.set(message.call_id, { ready: false });
      this.handlers.onSearching(true);
      this.handlers.onStatus("searching");
      void this.runTool(message).then((result) => {
        const slot = this.pending.get(message.call_id as string);
        if (!slot) return;
        slot.ready = true;
        slot.result = result;
        this.flushTools();
      });
      return;
    }

    if (message.type === "reply.done") {
      this.lastEvent = "reply.done";
      if (message.status === "interrupted") {
        this.pending.clear();
        this.handlers.onSearching(false);
      } else {
        this.flushTools();
      }
      if (this.pending.size === 0) this.handlers.onStatus(this.muted ? "muted" : "listening");
    }
  }

  private flushTools() {
    if (this.lastEvent !== "reply.done" || !this.socket) return;
    for (const [callId, slot] of this.pending) {
      if (!slot.ready) continue;
      this.socket.send(
        JSON.stringify({
          type: "tool.result",
          call_id: callId,
          result: JSON.stringify(slot.result),
        }),
      );
      this.pending.delete(callId);
    }
    if (this.pending.size === 0) this.handlers.onSearching(false);
  }

  private async runTool(event: ServerEvent) {
    if (event.name !== "search_assistance") {
      return { error: `Unknown tool ${event.name}. Tell the user you can help them find free food.` };
    }
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event.arguments ?? {}),
      });
      const data = (await response.json()) as SearchResponse & { tool_result?: unknown; error?: string; message?: string };
      this.patchContext(event.arguments);
      if (data.resources || data.search_status) this.handlers.onSearchResult(data);
      if (!response.ok) {
        return {
          error: data.message || data.error || "Search could not run.",
          speak_this: data.message || "I could not run that search. Ask for a San Francisco ZIP code if you do not have one yet.",
        };
      }
      return data.tool_result ?? data;
    } catch {
      return {
        error: "The search request failed.",
        speak_this: "I couldn't retrieve live results just now. Please try that question again.",
      };
    }
  }

  private patchContext(args: Record<string, unknown> | undefined) {
    if (!args) return;
    const patch: Partial<SessionContext> = {};
    if (args.category === "food") patch.category = args.category;
    if (typeof args.zip_code === "string") patch.zip = args.zip_code;
    if (args.urgency === "today" || args.urgency === "soon" || args.urgency === "ongoing") {
      patch.urgency = args.urgency;
    }
    if (typeof args.household_size === "number") patch.householdSize = args.household_size;
    if (typeof args.focus === "string" && (FOCUS_VALUES as readonly string[]).includes(args.focus)) {
      patch.focus = args.focus as SearchFocus;
    }
    this.handlers.onContext(patch);
  }

  private async startMicrophone() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.audioContext = new AudioContext();
    this.player = new PcmPlayer(this.audioContext);
    await this.audioContext.audioWorklet.addModule("/pcm-worklet.js");
    const source = this.audioContext.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.audioContext, "pcm-processor");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!this.ready || this.muted || this.socket?.readyState !== WebSocket.OPEN) return;
      this.socket.send(JSON.stringify({ type: "input.audio", audio: bytesToBase64(event.data) }));
    };
    source.connect(node);
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
  }
}

function microphoneErrorText(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access is blocked. Allow the microphone for this site in your browser, or type instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found. Connect one, or type instead.";
  }
  if (name === "NotReadableError") {
    return "Another app is using the microphone. Close it and try again, or type instead.";
  }
  return "The microphone could not start. You can type instead.";
}
