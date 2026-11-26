// Commit 3: HSP (Historical Service Performance) client.
// Finds the train a passenger booked and reports when it actually arrived.
// Must run server-side: HSP does not allow browser (CORS) requests.
//
// Two HSP calls:
//   serviceMetrics  – which services ran between two stations in a time window (gives RIDs)
//   serviceDetails  – per-station scheduled vs actual times for one RID

export interface HspConfig {
  baseUrl: string;                    // e.g. "https://hsp-prod.rockshore.net/api/v1" or the Rail Data Marketplace URL
  headers: Record<string, string>;    // Basic auth (old portal) or { "x-apikey": "..." } (Rail Data Marketplace)
  fetch?: typeof fetch;               // injectable for tests
}

export interface LegQuery {
  fromCrs: string;    // 3-letter station code, e.g. "EUS"
  toCrs: string;      // e.g. "MAN"
  departure: string;  // "YYYY-MM-DDTHH:MM", UK local
}

export type ArrivalResult =
  | { status: "arrived"; scheduledArrival: string; actualArrival: string; delayMinutes: number }
  | { status: "cancelled"; scheduledArrival: string; reasonCode?: string }
  | { status: "not_found"; detail: string };

interface MetricsResponse {
  Services: Array<{ serviceAttributesMetrics: { gbtt_ptd: string; rids: string[] } }>;
}

interface DetailsResponse {
  serviceAttributesDetails: {
    locations: Array<{
      location: string; gbtt_pta: string; actual_ta: string; late_canc_reason: string;
    }>;
  };
}

function dayType(date: string): "WEEKDAY" | "SATURDAY" | "SUNDAY" {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? "SUNDAY" : d === 6 ? "SATURDAY" : "WEEKDAY";
}

// "0830" → minutes past midnight
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
const fmt = (hhmm: string) => `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;

export async function findArrival(cfg: HspConfig, leg: LegQuery): Promise<ArrivalResult> {
  const doFetch = cfg.fetch ?? fetch;
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const res = await doFetch(`${cfg.baseUrl}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cfg.headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HSP ${path} failed: HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };

  const [date, time] = leg.departure.split("T");
  const hhmm = time.replace(":", "");

  const metrics = await post<MetricsResponse>("serviceMetrics", {
    from_loc: leg.fromCrs, to_loc: leg.toCrs,
    from_time: hhmm, to_time: hhmm,
    from_date: date, to_date: date,
    days: dayType(date),
  });

  const service = metrics.Services?.find((s) => s.serviceAttributesMetrics.gbtt_ptd === hhmm);
  const rid = service?.serviceAttributesMetrics.rids[0];
  if (!rid) return { status: "not_found", detail: `No ${time} service ${leg.fromCrs}→${leg.toCrs} on ${date}` };

  const details = await post<DetailsResponse>("serviceDetails", { rid });
  const stop = details.serviceAttributesDetails.locations.find((l) => l.location === leg.toCrs);
  if (!stop?.gbtt_pta) return { status: "not_found", detail: `Service ${rid} has no scheduled arrival at ${leg.toCrs}` };

  if (!stop.actual_ta) {
    return { status: "cancelled", scheduledArrival: fmt(stop.gbtt_pta),
             reasonCode: stop.late_canc_reason || undefined };
  }

  let delay = mins(stop.actual_ta) - mins(stop.gbtt_pta);
  if (delay < -720) delay += 1440;   // arrived after midnight
  return { status: "arrived", scheduledArrival: fmt(stop.gbtt_pta),
           actualArrival: fmt(stop.actual_ta), delayMinutes: Math.max(0, delay) };
}
