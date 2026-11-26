import type { HspConfig } from "../../src/hsp.ts";

// Fake HSP. Routes keyed "FROM-TO-HHMM" → { pta, ta } (ta "" = cancelled).
export function fakeHsp(routes: Record<string, { pta: string; ta: string }>, calls: string[] = []): HspConfig {
  return {
    baseUrl: "https://hsp.example/api/v1",
    headers: {},
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      let json: unknown;
      if (url.endsWith("serviceMetrics")) {
        const key = `${body.from_loc}-${body.to_loc}-${body.from_time}`;
        calls.push(key);
        json = { Services: routes[key]
          ? [{ serviceAttributesMetrics: { gbtt_ptd: body.from_time, rids: [key] } }] : [] };
      } else {
        const r = routes[body.rid];
        const to = body.rid.split("-")[1];
        json = { serviceAttributesDetails: { locations: [
          { location: to, gbtt_pta: r.pta, actual_ta: r.ta, late_canc_reason: r.ta ? "" : "XX" },
        ] } };
      }
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch,
  };
}
