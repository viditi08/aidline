import { createHmac, timingSafeEqual } from "node:crypto";

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string | null;
}

export function twilioConfig(env: NodeJS.ProcessEnv = process.env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) return null;
  return {
    accountSid,
    authToken,
    phoneNumber: env.TWILIO_PHONE_NUMBER?.trim() || null,
  };
}

/**
 * Twilio signs `url + <sorted key><value>...` with HMAC-SHA1 and the account auth token.
 * https://www.twilio.com/docs/usage/security#validating-signatures
 */
export function expectedSignature(authToken: string, url: string, params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
}

export function signatureMatches(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(expectedSignature(authToken, url, params), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * The URL Twilio signed. Behind a proxy (Vercel, ngrok) `request.url` can be the
 * internal origin, so prefer the forwarded host when it is present.
 */
export function signedUrl(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.TWILIO_WEBHOOK_BASE_URL?.trim();
  const url = new URL(request.url);
  if (override) {
    const base = new URL(override);
    return `${base.origin}${url.pathname}${url.search}`;
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedHost) {
    return `${forwardedProto ?? "https"}://${forwardedHost}${url.pathname}${url.search}`;
  }
  return url.toString();
}

export function formParams(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(body)) params[key] = value;
  return params;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function twimlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

const VOICE_ATTRS = 'voice="Polly.Joanna" language="en-US"';

export function say(text: string): string {
  return `<Say ${VOICE_ATTRS}>${escapeXml(text)}</Say>`;
}

export function gather(prompt: string, action: string, timeoutSeconds = 6): string {
  return (
    `<Gather input="speech" action="${escapeXml(action)}" method="POST" ` +
    `speechTimeout="auto" timeout="${timeoutSeconds}" language="en-US" actionOnEmptyResult="true">` +
    say(prompt) +
    `</Gather>`
  );
}

export function hangup(): string {
  return "<Hangup/>";
}

/** Sends an SMS through the Twilio REST API. Returns null on success, else an error string. */
export async function sendSms(
  config: TwilioConfig,
  to: string,
  body: string,
  timeoutMs = 10000,
): Promise<string | null> {
  if (!config.phoneNumber) return "TWILIO_PHONE_NUMBER is not set.";
  const form = new URLSearchParams({ To: to, From: config.phoneNumber, Body: body });
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      console.error(`Twilio send failed (${response.status}): ${detail.slice(0, 300)}`);
      return "The text message could not be sent.";
    }
    return null;
  } catch (error) {
    console.error("Twilio send error", error instanceof Error ? error.message : error);
    return "The text message could not be sent.";
  }
}

/**
 * Reads a Twilio webhook (form-encoded) and checks its signature.
 * Returns the params, or a Response to send back when the request is rejected.
 */
export async function readTwilioWebhook(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ params: Record<string, string>; config: TwilioConfig | null } | Response> {
  const params = formParams(await request.text());
  const config = twilioConfig(env);
  const skip = env.TWILIO_SKIP_SIGNATURE === "1" && env.NODE_ENV !== "production";
  if (skip) return { params, config };
  if (!config) {
    return new Response("Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.", { status: 503 });
  }
  if (!signatureMatches(config.authToken, signedUrl(request, env), params, request.headers.get("x-twilio-signature"))) {
    return new Response("Invalid Twilio signature.", { status: 403 });
  }
  return { params, config };
}

export function webhookPath(request: Request, path: string, env: NodeJS.ProcessEnv = process.env): string {
  return new URL(path, signedUrl(request, env)).toString();
}
