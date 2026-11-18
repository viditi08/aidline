/**
 * Connects a Twilio number to AidLine:
 *   Twilio number → Elastic SIP trunk → AssemblyAI Voice Agent → /api/phone-tool → Parallel Search + Decisions
 *
 *   npm run phone:setup              full setup (safe to re-run)
 *   npm run phone:setup -- --agent   only update the AssemblyAI agent (e.g. after the tunnel URL changes)
 *   npm run phone:setup -- --dry-run show what would be sent, change nothing
 *
 * Reads .env.local: ASSEMBLYAI_API_KEY, PHONE_TOOL_SECRET, PUBLIC_BASE_URL,
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.
 * Docs: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/twilio-own-number
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PHONE_SECRET_HEADER, phoneAgentConfig } from "@/lib/phone";

const AAI = "https://agents.us.assemblyai.com/v1";
const TRUNKING = "https://trunking.twilio.com/v1";
const STATE_FILE = ".aidline-phone.json";
const TRUNK_NAME = "AidLine AssemblyAI";
const SIP_URL = "sip:sip.assemblyai.com";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const agentOnly = args.has("--agent");

interface State {
  agent_id?: string;
  trunk_sid?: string;
  trunk_domain?: string;
}

function env(name: string, required = true): string {
  const value = process.env[name]?.trim() ?? "";
  if (required && !value) fail(`${name} is empty in .env.local.`);
  return value;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function step(message: string) {
  console.log(`• ${message}`);
}

function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as State) : {};
}

function saveState(state: State) {
  if (!dryRun) writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function request(url: string, init: RequestInit, label: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!response.ok && response.status !== 409) {
    fail(`${label} failed (${response.status}): ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
  }
  return { status: response.status, body };
}

// ---------- AssemblyAI ----------

let aaiAuth = "";
async function aai(path: string, method: string, body: unknown, label: string, extraHeaders: Record<string, string> = {}) {
  const key = env("ASSEMBLYAI_API_KEY");
  const send = (auth: string) =>
    fetch(`${AAI}${path}`, {
      method,
      headers: { Authorization: auth, "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  // The docs show both "Bearer <key>" and a bare key; use whichever AssemblyAI accepts.
  let response = await send(aaiAuth || `Bearer ${key}`);
  if (response.status === 401 && !aaiAuth) {
    response = await send(key);
    if (response.status !== 401) aaiAuth = key;
  } else if (!aaiAuth) {
    aaiAuth = `Bearer ${key}`;
  }
  const text = await response.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  if (!response.ok && response.status !== 409) fail(`${label} failed (${response.status}): ${text.slice(0, 400)}`);
  return { status: response.status, body: parsed };
}

async function upsertAgent(state: State, toolUrl: string): Promise<string> {
  const config = phoneAgentConfig(toolUrl, env("PHONE_TOOL_SECRET"));
  if (dryRun) {
    const shown = structuredClone(config);
    shown.tools[0].http.headers[0].value = "<PHONE_TOOL_SECRET>";
    console.log(JSON.stringify({ ...shown, system_prompt: `${shown.system_prompt.slice(0, 160)}…` }, null, 2));
    return state.agent_id ?? "<new agent>";
  }
  if (state.agent_id) {
    await aai(`/agents/${state.agent_id}`, "PUT", config, "Updating the AssemblyAI agent");
    step(`Updated AssemblyAI agent ${state.agent_id}`);
    return state.agent_id;
  }
  const { body } = await aai("/agents", "POST", config, "Creating the AssemblyAI agent");
  const id = body?.id ?? body?.agent_id;
  if (!id) fail(`AssemblyAI did not return an agent id: ${JSON.stringify(body).slice(0, 300)}`);
  state.agent_id = id;
  saveState(state);
  step(`Created AssemblyAI agent ${id}`);
  return id;
}

// ---------- Twilio ----------

function twilioAuth() {
  return `Basic ${Buffer.from(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64")}`;
}

function form(values: Record<string, string>) {
  return { headers: { Authorization: twilioAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(values).toString() };
}

async function twilioGet(url: string, label: string) {
  return request(url, { headers: { Authorization: twilioAuth() } }, label);
}

async function setupTrunk(state: State, phoneNumber: string): Promise<string> {
  // 1. Trunk
  let trunk: any = null;
  if (state.trunk_sid) {
    const found = await fetch(`${TRUNKING}/Trunks/${state.trunk_sid}`, { headers: { Authorization: twilioAuth() } });
    if (found.ok) trunk = await found.json();
  }
  if (!trunk) {
    const { body } = await twilioGet(`${TRUNKING}/Trunks?PageSize=100`, "Listing Twilio SIP trunks");
    trunk = (body?.trunks ?? []).find((item: any) => item.friendly_name === TRUNK_NAME) ?? null;
  }
  if (!trunk) {
    const domain = `aidline-${randomBytes(4).toString("hex")}.pstn.twilio.com`;
    const { body } = await request(`${TRUNKING}/Trunks`, { method: "POST", ...form({ FriendlyName: TRUNK_NAME, DomainName: domain }) }, "Creating the Twilio SIP trunk");
    trunk = body;
    step(`Created Twilio SIP trunk ${domain}`);
  } else {
    step(`Using Twilio SIP trunk ${trunk.domain_name}`);
  }
  state.trunk_sid = trunk.sid;
  state.trunk_domain = trunk.domain_name;
  saveState(state);

  // 2. Origination: send calls to AssemblyAI
  const { body: origins } = await twilioGet(`${TRUNKING}/Trunks/${trunk.sid}/OriginationUrls`, "Listing trunk origination URLs");
  const hasOrigin = (origins?.origination_urls ?? []).some((item: any) => item.sip_url === SIP_URL);
  if (!hasOrigin) {
    await request(
      `${TRUNKING}/Trunks/${trunk.sid}/OriginationUrls`,
      { method: "POST", ...form({ FriendlyName: "AssemblyAI SIP", SipUrl: SIP_URL, Priority: "1", Weight: "1", Enabled: "true" }) },
      "Adding the AssemblyAI origination URL",
    );
    step(`Routed the trunk to ${SIP_URL}`);
  }

  // 3. Attach the number to the trunk
  const sid = env("TWILIO_ACCOUNT_SID");
  const { body: numbers } = await twilioGet(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
    "Looking up the Twilio number",
  );
  const number = numbers?.incoming_phone_numbers?.[0];
  if (!number) fail(`${phoneNumber} is not a number in this Twilio account.`);
  if (number.trunk_sid !== trunk.sid) {
    await request(`${TRUNKING}/Trunks/${trunk.sid}/PhoneNumbers`, { method: "POST", ...form({ PhoneNumberSid: number.sid }) }, "Attaching the number to the trunk");
    step(`Attached ${phoneNumber} to the trunk`);
  } else {
    step(`${phoneNumber} is already on the trunk`);
  }
  return trunk.domain_name;
}

// ---------- Main ----------

async function main() {
  const base = env("PUBLIC_BASE_URL").replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) fail("PUBLIC_BASE_URL must start with https:// (AssemblyAI only calls public HTTPS URLs).");
  const toolUrl = `${base}/api/phone-tool`;
  const phoneNumber = env("TWILIO_PHONE_NUMBER", !(agentOnly || dryRun));
  if (phoneNumber && !/^\+[1-9]\d{7,14}$/.test(phoneNumber)) fail("TWILIO_PHONE_NUMBER must look like +14155550123.");

  // Check AidLine's tool answers from the public address before wiring the phone to it.
  step(`Checking ${toolUrl}`);
  if (!dryRun) {
    const probe = await fetch(toolUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", [PHONE_SECRET_HEADER]: env("PHONE_TOOL_SECRET") },
      body: JSON.stringify({ category: "food", zip_code: "94103", focus: "helpline" }),
      signal: AbortSignal.timeout(20000),
    }).catch((error: unknown) => fail(`Could not reach ${toolUrl}: ${error instanceof Error ? error.message : error}. Is the tunnel running?`));
    const text = await probe.text();
    if (!probe.ok || !text.includes("2-1-1")) fail(`The tool did not answer correctly (${probe.status}): ${text.slice(0, 200)}`);
    step("AidLine's phone tool answers correctly");
  }

  const state = loadState();
  const agentId = await upsertAgent(state, toolUrl);
  if (agentOnly || dryRun) {
    console.log(dryRun ? "\nDry run: nothing was changed." : "\n✓ Agent updated. The number stays connected to it.");
    return;
  }

  const domain = await setupTrunk(state, phoneNumber);

  const imported = await aai(
    "/phone-numbers/import",
    "POST",
    { phone_number: phoneNumber, termination_uri: domain },
    "Registering the number with AssemblyAI",
    { "Idempotency-Key": randomUUID() },
  );
  step(imported.status === 409 ? "Number already registered with AssemblyAI" : "Registered the number with AssemblyAI");

  const path = `/phone-numbers/${encodeURIComponent(phoneNumber)}`;
  await aai(`${path}/agent`, "PUT", { agent_id: agentId }, "Connecting the number to the agent");
  const { body } = await aai(path, "GET", undefined, "Checking the number");
  if (body?.agent_id && body.agent_id !== agentId) fail(`The number is connected to a different agent (${body.agent_id}).`);
  step("Number connected to the AidLine agent");

  console.log(`\n✓ Done. Call ${phoneNumber} and say: "I haven't eaten today, I'm in 94102."`);
  console.log("  If the tunnel URL changes, update PUBLIC_BASE_URL and run: npm run phone:setup -- --agent");
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
