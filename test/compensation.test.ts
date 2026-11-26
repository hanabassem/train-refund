import { test } from "node:test";
import assert from "node:assert/strict";
import { assess } from "../src/compensation.ts";

const base = { operator: "Avanti West Coast", ticketType: "single" as const,
               farePence: 8000, cancelled: false };

test("under 15 min is not eligible", () => {
  assert.equal(assess({ ...base, delayMinutes: 14 }).eligible, false);
});

test("DR15 single, 20 min → 25%", () => {
  assert.equal(assess({ ...base, delayMinutes: 20 }).refundPence, 2000);
});

test("return ticket, 45 min → 50% of half the fare", () => {
  assert.equal(assess({ ...base, ticketType: "return", delayMinutes: 45 }).refundPence, 2000);
});

test("return ticket, 120+ min → full return fare", () => {
  assert.equal(assess({ ...base, ticketType: "return", delayMinutes: 130 }).refundPence, 8000);
});

test("LNER is DR30: 20 min not eligible, 35 min → 50%", () => {
  assert.equal(assess({ ...base, operator: "LNER", delayMinutes: 20 }).eligible, false);
  assert.equal(assess({ ...base, operator: "LNER", delayMinutes: 35 }).refundPence, 4000);
});

test("unknown operator is rejected, not guessed", () => {
  const r = assess({ ...base, operator: "Unknown Rail", delayMinutes: 60 });
  assert.equal(r.eligible, false);
});
