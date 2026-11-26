// Gmail (read-only) connection: finds Trainline booking emails and adds them as journeys.
// Uses Google's OAuth 2.0 + Gmail REST API directly with fetch (no SDK needed).
// Setup: create an OAuth client in Google Cloud Console → see README.

import { randomBytes } from "node:crypto";
import { parseTrainlineEmail } from "./booking.ts";
import { addBooking, type AppData } from "./store.ts";
import type { RouteContext } from "./server.ts";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;       // e.g. http://localhost:3000/auth/google/callback
  fetch?: typeof fetch;
}

export const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const BOOKING_QUERY = "from:trainline.com newer_than:30d";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export function googleConfigFromEnv(env = process.env): GoogleConfig | undefined {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return undefined;
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
           redirectUri: env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/auth/google/callback" };
}

export function authUrl(cfg: GoogleConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code",
    scope: SCOPE, access_type: "offline", prompt: "consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(cfg: GoogleConfig, params: Record<string, string>) {
  const res = await (cfg.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...params }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed: HTTP ${res.status}`);
  return res.json() as Promise<{ access_token: string; refresh_token?: string }>;
}

export async function exchangeCode(cfg: GoogleConfig, code: string): Promise<string> {
  const t = await tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri });
  if (!t.refresh_token) throw new Error("Google did not return a refresh token; remove the app's access in your Google account and connect again");
  return t.refresh_token;
}

export const accessToken = async (cfg: GoogleConfig, refreshToken: string) =>
  (await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken })).access_token;

// ---- email body extraction ----

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&pound;/g, "£").replace(/&rarr;/g, "→")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

// Prefer the plain-text part; fall back to HTML converted to text.
export function extractText(payload: Part): string | undefined {
  const all: Part[] = [];
  const walk = (p: Part) => { all.push(p); p.parts?.forEach(walk); };
  walk(payload);
  const decode = (p?: Part) => p?.body?.data ? Buffer.from(p.body.data, "base64url").toString("utf8") : undefined;
  const plain = decode(all.find((p) => p.mimeType === "text/plain" && p.body?.data));
  if (plain) return plain;
  const html = decode(all.find((p) => p.mimeType === "text/html" && p.body?.data));
  return html && htmlToText(html);
}

export async function fetchEmailBodies(cfg: GoogleConfig, token: string, query = BOOKING_QUERY): Promise<string[]> {
  const get = async (path: string) => {
    const res = await (cfg.fetch ?? fetch)(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Gmail request failed: HTTP ${res.status}`);
    return res.json() as Promise<any>;
  };
  const list = await get(`/messages?${new URLSearchParams({ q: query, maxResults: "50" })}`);
  const bodies: string[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = await get(`/messages/${id}?format=full`);
    const text = extractText(msg.payload ?? {});
    if (text) bodies.push(text);
  }
  return bodies;
}

// Pull booking emails and add new journeys. Non-booking emails (marketing etc.) are skipped.
export async function syncGmail(cfg: GoogleConfig, data: AppData, now = new Date()) {
  if (!data.google?.refreshToken) throw new Error("Gmail is not connected");
  const token = await accessToken(cfg, data.google.refreshToken);
  const bodies = await fetchEmailBodies(cfg, token);
  let added = 0;
  for (const body of bodies) {
    try { if (addBooking(data, parseTrainlineEmail(body), now)) added++; } catch { /* not a booking */ }
  }
  data.google.lastSync = now.toISOString();
  return { scanned: bodies.length, added };
}

// ---- routes plugged into the server ----

export function gmailRoutes(cfg: GoogleConfig) {
  const pendingStates = new Set<string>();
  return async ({ req, res, url, withData, json }: RouteContext): Promise<boolean> => {
    if (req.method === "GET" && url.pathname === "/auth/google") {
      const state = randomBytes(16).toString("hex");
      pendingStates.add(state);
      res.writeHead(302, { Location: authUrl(cfg, state) }).end();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/auth/google/callback") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code");
      if (!pendingStates.delete(state) || !code) { json(400, { error: "Invalid sign-in response" }); return true; }
      const refreshToken = await exchangeCode(cfg, code);
      await withData((d) => { d.google = { refreshToken }; });
      res.writeHead(302, { Location: "/" }).end();
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/gmail/sync") {
      json(200, await withData((d) => syncGmail(cfg, d)));
      return true;
    }
    return false;
  };
}
