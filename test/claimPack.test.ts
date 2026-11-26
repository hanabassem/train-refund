import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaimPack, claimPackText, type Profile } from "../src/claimPack.ts";
import { checkBooking } from "../src/matcher.ts";
import type { Booking } from "../src/booking.ts";
import { fakeHsp } from "./helpers/fakeHsp.ts";

const profile: Profile = { fullName: "Sam Rider", email: "sam@example.com", addressLine1: "1 High St",
                           town: "Leeds", postcode: "LS1 1AA", payout: "original_payment" };
const booking: Booking = {
  retailer: "Trainline", reference: "TL8X2K9Q", ticketType: "single", farePence: 4560,
  legs: [{ operator: "Avanti West Coast", origin: "London Euston", destination: "Manchester Piccadilly",
           departure: "2026-11-20T08:30", arrival: "2026-11-20T10:41" }],
};

test("claim pack has every form field, deadline and the operator link", async () => {
  const outcome = await checkBooking(booking, fakeHsp({ "EUS-MAN-0830": { pta: "1041", ta: "1103" } }));
  assert.equal(outcome.status, "owed");
  if (outcome.status !== "owed") return;
  const pack = buildClaimPack(profile, booking, outcome);
  assert.equal(pack.deadline, "2026-12-18");
  assert.match(pack.claimUrl!, /avantiwestcoast/);
  assert.equal(pack.expectedRefundPence, 1140);
  const text = claimPackText(pack);
  assert.match(text, /Booking reference: TL8X2K9Q/);
  assert.match(text, /Actual arrival: 11:03/);
  assert.match(text, /Delay \(minutes\): 22/);
  assert.doesNotMatch(text, /card|sort code|account number/i);
});
