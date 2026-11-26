import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBooking, resolveWithArrivalTime } from "../src/matcher.ts";
import { toCrs } from "../src/stations.ts";
import type { Booking } from "../src/booking.ts";
import { fakeHsp } from "./helpers/fakeHsp.ts";

const direct: Booking = {
  retailer: "Trainline", reference: "R1", ticketType: "single", farePence: 8000,
  legs: [{ operator: "Avanti West Coast", origin: "London Euston", destination: "Manchester Piccadilly",
           departure: "2026-11-20T08:30", arrival: "2026-11-20T10:41" }],
};

const withChange: Booking = {
  ...direct, reference: "R2",
  legs: [direct.legs[0],
         { operator: "Northern", origin: "Manchester Piccadilly", destination: "Stockport",
           departure: "2026-11-20T10:58", arrival: "2026-11-20T11:26" }],
};

test("station names map to CRS codes", () => {
  assert.equal(toCrs("London King's Cross"), "KGX");
  assert.equal(toCrs("Stoke-on-Trent"), "SOT");
  assert.equal(toCrs("EUS"), "EUS");
  assert.throws(() => toCrs("Hogwarts"));
});

test("direct train 35 min late → owed 50%", async () => {
  const r = await checkBooking(direct, fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1116" } }));
  assert.equal(r.status, "owed");
  if (r.status === "owed") {
    assert.equal(r.delayMinutes, 35);
    assert.equal(r.actualArrival, "11:16");
    assert.equal(r.assessment.refundPence, 4000);
  }
});

test("on time → not owed", async () => {
  const r = await checkBooking(direct, fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1043" } }));
  assert.equal(r.status, "not_owed");
});

test("connection made, second train late → delay measured at final destination", async () => {
  const r = await checkBooking(withChange, fakeHsp({
    "EUS-MAN-0830": { pta: "1041", ta: "1050" },
    "MAN-SPT-1058": { pta: "1126", ta: "1146" },
  }));
  assert.equal(r.status, "owed");
  if (r.status === "owed") { assert.equal(r.delayMinutes, 20); assert.equal(r.operator, "Northern"); }
});

test("missed connection → ask passenger for arrival time, then resolve", async () => {
  const r = await checkBooking(withChange, fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1110" } }));
  assert.equal(r.status, "needs_arrival_time");
  if (r.status !== "needs_arrival_time") return;
  const resolved = resolveWithArrivalTime(withChange, r, "12:30");
  assert.equal(resolved.status, "owed");
  if (resolved.status === "owed") {
    assert.equal(resolved.delayMinutes, 64);
    assert.equal(resolved.operator, "Avanti West Coast");
    assert.equal(resolved.assessment.percentOfLegFare, 100);
  }
});

test("cancelled train → needs arrival time", async () => {
  const r = await checkBooking(direct, fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "" } }));
  assert.equal(r.status, "needs_arrival_time");
});

test("unknown station → unknown, no HSP call", async () => {
  const calls: string[] = [];
  const b = { ...direct, legs: [{ ...direct.legs[0], origin: "Hogwarts" }] };
  const r = await checkBooking(b, fakeHsp({}, calls));
  assert.equal(r.status, "unknown");
  assert.equal(calls.length, 0);
});
