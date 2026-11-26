import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rateLimited, runChecks, ukLocalNow } from "../src/scheduler.ts";
import { addBooking, emptyData, loadData, saveData } from "../src/store.ts";
import type { Booking } from "../src/booking.ts";
import { fakeHsp } from "./helpers/fakeHsp.ts";

const booking: Booking = {
  retailer: "Trainline", reference: "R1", ticketType: "single", farePence: 8000,
  legs: [{ operator: "Avanti West Coast", origin: "London Euston", destination: "Manchester Piccadilly",
           departure: "2026-11-20T08:30", arrival: "2026-11-20T10:41" }],
};
const late = () => fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1116" } });

test("UK local time handles GMT and BST", () => {
  assert.equal(ukLocalNow(new Date("2026-11-20T12:00:00Z")), "2026-11-20T12:00");
  assert.equal(ukLocalNow(new Date("2026-07-01T12:00:00Z")), "2026-07-01T13:00");
});

test("rate limiter spaces out requests", async () => {
  const f = rateLimited((async () => new Response("{}")) as typeof fetch, 50);
  const start = Date.now();
  await Promise.all([f("a"), f("b"), f("c")]);
  assert.ok(Date.now() - start >= 95);
});

test("journey not arrived yet is skipped", async () => {
  const data = emptyData(); addBooking(data, booking);
  const r = await runChecks(data, { hsp: late(), now: new Date("2026-11-20T10:00:00Z"), notifier: { notify: async () => {} } });
  assert.equal(r.checked, 0);
});

test("late journey creates one claim and one notification, even if run twice", async () => {
  const data = emptyData(); addBooking(data, booking);
  const sent: string[] = [];
  const opts = { hsp: late(), now: new Date("2026-11-20T13:00:00Z"),
                 notifier: { notify: async (t: string) => { sent.push(t); } } };
  const r = await runChecks(data, opts);
  await runChecks(data, opts);
  assert.equal(r.newClaims.length, 1);
  assert.equal(data.claims.length, 1);
  assert.deepEqual(sent, ["You're owed £40.00"]);
});

test("journeys past the 28-day deadline are skipped", async () => {
  const data = emptyData(); addBooking(data, booking);
  const r = await runChecks(data, { hsp: late(), now: new Date("2026-12-30T12:00:00Z"), notifier: { notify: async () => {} } });
  assert.equal(r.checked, 0);
});

test("store saves and loads, and ignores duplicate bookings", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "tr-")), "data.json");
  assert.deepEqual(await loadData(file), emptyData());
  const data = emptyData();
  assert.equal(addBooking(data, booking), true);
  assert.equal(addBooking(data, booking), false);
  await saveData(file, data);
  assert.equal((await loadData(file)).journeys.length, 1);
});
