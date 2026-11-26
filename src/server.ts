// HTTP API + one-tap web page. Single user, binds to localhost by default (prototype: no login yet).
// Run: npm start   (reads settings from .env — see .env.example)

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { HspConfig } from "./hsp.ts";
import { parseTrainlineEmail } from "./booking.ts";
import { resolveWithArrivalTime } from "./matcher.ts";
import { buildClaimPack, claimDeadline, claimPackText, type Profile } from "./claimPack.ts";
import { addBooking, addClaim, loadData, saveData, type AppData, type ClaimStatus } from "./store.ts";
import { consoleNotifier, rateLimited, runChecks, type Notifier } from "./scheduler.ts";
import { gmailRoutes, googleConfigFromEnv, syncGmail } from "./gmail.ts";

export interface AppConfig {
  dataFile: string;
  hsp: HspConfig;
  notifier?: Notifier;
  now?: () => Date;
  extraRoutes?: (ctx: RouteContext) => Promise<boolean>;   // lets later modules (e.g. Gmail) add routes
}

export interface RouteContext {
  req: IncomingMessage; res: ServerResponse; url: URL;
  body: () => Promise<any>;
  withData: <T>(fn: (d: AppData) => Promise<T> | T) => Promise<T>;
  json: (status: number, value: unknown) => void;
}

export function configFromEnv(env = process.env): AppConfig {
  const headers: Record<string, string> = env.HSP_API_KEY
    ? { "x-apikey": env.HSP_API_KEY }
    : env.HSP_USERNAME
      ? { Authorization: "Basic " + Buffer.from(`${env.HSP_USERNAME}:${env.HSP_PASSWORD ?? ""}`).toString("base64") }
      : {};
  return {
    dataFile: env.DATA_FILE ?? "data.json",
    hsp: { baseUrl: env.HSP_BASE_URL ?? "https://hsp-prod.rockshore.net/api/v1", headers, fetch: rateLimited(fetch) },
  };
}

const PAYOUTS = ["original_payment", "bank_transfer", "voucher", "charity"];
const STATUSES: ClaimStatus[] = ["ready", "submitted", "paid", "rejected"];

function validProfile(p: any): Profile {
  for (const k of ["fullName", "email", "addressLine1", "town", "postcode"]) {
    if (typeof p?.[k] !== "string" || !p[k].trim()) throw new Error(`Missing ${k}`);
  }
  if (!PAYOUTS.includes(p.payout)) throw new Error("Invalid payout");
  return { fullName: p.fullName, email: p.email, addressLine1: p.addressLine1, town: p.town,
           postcode: p.postcode, payout: p.payout };
}

// What the web page sees.
export function view(data: AppData) {
  const byRef = new Map(data.journeys.map((j) => [j.booking.reference, j]));
  return {
    profile: data.profile ?? null,
    gmailConnected: Boolean(data.google?.refreshToken),
    journeys: data.journeys.map(({ booking: b, outcome }) => ({
      reference: b.reference, from: b.legs[0].origin, to: b.legs[b.legs.length - 1].destination,
      departure: b.legs[0].departure, status: outcome?.status ?? "waiting",
      reason: outcome && "reason" in outcome ? outcome.reason : undefined,
    })),
    claims: data.claims.map((c) => {
      const j = byRef.get(c.bookingRef);
      const pack = j && data.profile && j.outcome?.status === "owed"
        ? buildClaimPack(data.profile, j.booking, j.outcome) : undefined;
      return { ...c, deadline: j ? claimDeadline(j.booking) : undefined,
               claimUrl: pack?.claimUrl, fields: pack?.fields, packText: pack && claimPackText(pack) };
    }),
  };
}

export function createApp(cfg: AppConfig) {
  const notifier = cfg.notifier ?? consoleNotifier;
  const now = cfg.now ?? (() => new Date());
  let lock: Promise<unknown> = Promise.resolve();

  // Serialise every read-modify-write of the data file.
  const withData = <T>(fn: (d: AppData) => Promise<T> | T): Promise<T> => {
    const run = lock.then(async () => {
      const data = await loadData(cfg.dataFile);
      const result = await fn(data);
      await saveData(cfg.dataFile, data);
      return result;
    });
    lock = run.catch(() => {});
    return run;
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const body = async () => {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 1_000_000) throw new Error("Body too large");
      }
      return raw ? JSON.parse(raw) : {};
    };
    const route = `${req.method} ${url.pathname}`;
    const m = (re: RegExp) => url.pathname.match(re);

    try {
      if (cfg.extraRoutes && await cfg.extraRoutes({ req, res, url, body, withData, json })) return;

      if (route === "GET /") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(await readFile(new URL("../public/index.html", import.meta.url)));
      }
      if (route === "GET /api/state") {
        return json(200, { ...view(await loadData(cfg.dataFile)), gmailAvailable: Boolean(cfg.extraRoutes) });
      }

      if (route === "PUT /api/profile") {
        const profile = validProfile(await body());
        await withData((d) => { d.profile = profile; });
        return json(200, { ok: true });
      }
      if (route === "POST /api/bookings") {
        const { email } = await body();
        const booking = parseTrainlineEmail(String(email ?? ""));
        const added = await withData((d) => addBooking(d, booking, now()));
        return json(200, { added, reference: booking.reference });
      }
      if (route === "POST /api/check") {
        const r = await withData((d) => runChecks(d, { hsp: cfg.hsp, now: now(), notifier }));
        return json(200, { checked: r.checked, newClaims: r.newClaims.length });
      }
      let p = m(/^\/api\/journeys\/([^/]+)\/arrival$/);
      if (req.method === "POST" && p) {
        const { time } = await body();
        const ref = decodeURIComponent(p[1]);
        const status = await withData((d) => {
          const j = d.journeys.find((x) => x.booking.reference === ref);
          if (!j || j.outcome?.status !== "needs_arrival_time") throw new Error("Journey is not waiting for an arrival time");
          j.outcome = resolveWithArrivalTime(j.booking, j.outcome, String(time));
          if (j.outcome.status === "owed") addClaim(d, ref, j.outcome, now());
          return j.outcome.status;
        });
        return json(200, { status });
      }
      p = m(/^\/api\/claims\/([^/]+)\/status$/);
      if (req.method === "POST" && p) {
        const { status } = await body();
        if (!STATUSES.includes(status)) throw new Error("Invalid status");
        await withData((d) => {
          const c = d.claims.find((x) => x.id === p![1]);
          if (!c) throw new Error("Claim not found");
          c.status = status; c.updatedAt = now().toISOString();
        });
        return json(200, { ok: true });
      }
      json(404, { error: "Not found" });
    } catch (e) {
      json(400, { error: (e as Error).message });
    }
  });
  return { server, withData };
}

// Start when run directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = configFromEnv();
  const google = googleConfigFromEnv();
  if (google) cfg.extraRoutes = gmailRoutes(google);
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  const { server, withData } = createApp(cfg);
  server.listen(port, host, () => console.log(`Train refund app on http://${host}:${port}`));

  // Every 15 minutes: pull new booking emails (if Gmail is connected), then check journeys.
  const tick = () => withData(async (d) => {
    if (google && d.google?.refreshToken) await syncGmail(google, d);
    await runChecks(d, { hsp: cfg.hsp });
  })
    .catch((e) => console.error("Background check failed:", (e as Error).message));
  setInterval(tick, 15 * 60 * 1000);
}
