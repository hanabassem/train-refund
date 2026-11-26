import { test } from "node:test";
import assert from "node:assert/strict";
import { findArrival, type HspConfig } from "../src/hsp.ts";

// Fake HSP server. Response shapes follow the documented HSP format;
// re-check against a real response once we have an API key.
function fakeHsp(arrival: { actual_ta: string; late_canc_reason?: string }, calls: any[] = []): HspConfig {
  return {
    baseUrl: "https://hsp.example/api/v1",
    headers: { "x-apikey": "test" },
    fetch: (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const json = url.endsWith("serviceMetrics")
        ? { Services: [{ serviceAttributesMetrics: { gbtt_ptd: "0830", rids: ["202611207654321"] } }] }
        : { serviceAttributesDetails: { locations: [
            { location: "EUS", gbtt_pta: "", actual_ta: "", late_canc_reason: "" },
            { location: "MAN", gbtt_pta: "1041", late_canc_reason: "", ...arrival },
          ] } };
      return new Response(JSON.stringify(json), { status: 200 });
    }) as typeof fetch,
  };
}

const leg = { fromCrs: "EUS", toCrs: "MAN", departure: "2026-11-20T08:30" };

test("reports a 32-minute delay", async () => {
  const r = await findArrival(fakeHsp({ actual_ta: "1113" }), leg);
  assert.deepEqual(r, { status: "arrived", scheduledArrival: "10:41",
                        actualArrival: "11:13", delayMinutes: 32 });
});

test("early arrival counts as 0 delay", async () => {
  const r = await findArrival(fakeHsp({ actual_ta: "1039" }), leg);
  assert.equal(r.status === "arrived" && r.delayMinutes, 0);
});

test("no actual arrival means cancelled", async () => {
  const r = await findArrival(fakeHsp({ actual_ta: "", late_canc_reason: "IA" }), leg);
  assert.deepEqual(r, { status: "cancelled", scheduledArrival: "10:41", reasonCode: "IA" });
});

test("sends the right search to HSP (Friday = WEEKDAY)", async () => {
  const calls: any[] = [];
  await findArrival(fakeHsp({ actual_ta: "1041" }, calls), leg);
  assert.deepEqual(calls[0].body, { from_loc: "EUS", to_loc: "MAN", from_time: "0830",
    to_time: "0830", from_date: "2026-11-20", to_date: "2026-11-20", days: "WEEKDAY" });
  assert.deepEqual(calls[1].body, { rid: "202611207654321" });
});

test("train not in HSP → not_found, no guessing", async () => {
  const r = await findArrival(fakeHsp({ actual_ta: "1041" }), { ...leg, departure: "2026-11-20T09:00" });
  assert.equal(r.status, "not_found");
});
