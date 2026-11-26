import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTrainlineEmail } from "../src/booking.ts";

const sample = readFileSync(new URL("./fixtures/trainline-sample.txt", import.meta.url), "utf8");

test("parses reference, fare and ticket type", () => {
  const b = parseTrainlineEmail(sample);
  assert.equal(b.reference, "TL8X2K9Q");
  assert.equal(b.farePence, 4560);
  assert.equal(b.ticketType, "single");
});

test("parses every leg with operator and UK local times", () => {
  const b = parseTrainlineEmail(sample);
  assert.equal(b.legs.length, 2);
  assert.deepEqual(b.legs[0], {
    operator: "Avanti West Coast",
    origin: "London Euston",
    destination: "Manchester Piccadilly",
    departure: "2026-11-20T08:30",
    arrival: "2026-11-20T10:41",
  });
  assert.equal(b.legs[1].operator, "Northern");
});

test("fails loudly on an email it doesn't understand", () => {
  assert.throws(() => parseTrainlineEmail("Hello, here is a newsletter"));
});
