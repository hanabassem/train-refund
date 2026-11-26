// Claim pack: everything an operator's Delay Repay form asks for, ready to copy in one tap.
// We never store bank or card details — the passenger chooses payout on the operator's site.

import type { Booking } from "./booking.ts";
import type { JourneyOutcome } from "./matcher.ts";

export interface Profile {
  fullName: string;
  email: string;
  addressLine1: string;
  town: string;
  postcode: string;
  payout: "original_payment" | "bank_transfer" | "voucher" | "charity";
}

// Operator Delay Repay pages (checked Nov 2026). Claims go to the operator that caused the delay.
export const CLAIM_URLS: Record<string, string> = {
  "Avanti West Coast": "https://www.avantiwestcoast.co.uk/help-and-support/delay-repay",
  "LNER": "https://www.lner.co.uk/support/delay-repay/",
  "Northern": "https://www.northernrailway.co.uk/delay-repay",
  "TransPennine Express": "https://www.tpexpress.co.uk/help/delay-repay-compensation",
  "Great Western Railway": "https://www.gwr.com/help-and-support/refunds-and-compensation",
};

export const CLAIM_WINDOW_DAYS = 28;

export interface ClaimPack {
  operator: string;
  claimUrl?: string;
  deadline: string;             // YYYY-MM-DD, last day to claim
  expectedRefundPence: number;
  fields: Array<{ label: string; value: string }>;
}

const pounds = (p: number) => `£${(p / 100).toFixed(2)}`;
const PAYOUT_LABEL: Record<Profile["payout"], string> = {
  original_payment: "Refund to original payment method", bank_transfer: "Bank transfer",
  voucher: "Rail voucher", charity: "Donate to charity",
};

export function claimDeadline(b: Booking): string {
  const d = new Date(`${b.legs[0].departure.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CLAIM_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

export function buildClaimPack(profile: Profile, b: Booking,
                               outcome: JourneyOutcome & { status: "owed" }): ClaimPack {
  const first = b.legs[0];
  const last = b.legs[b.legs.length - 1];
  return {
    operator: outcome.operator,
    claimUrl: CLAIM_URLS[outcome.operator],
    deadline: claimDeadline(b),
    expectedRefundPence: outcome.assessment.refundPence,
    fields: [
      { label: "Full name", value: profile.fullName },
      { label: "Email", value: profile.email },
      { label: "Address", value: `${profile.addressLine1}, ${profile.town}` },
      { label: "Postcode", value: profile.postcode },
      { label: "Booking reference", value: b.reference },
      { label: "Bought from", value: b.retailer },
      { label: "Ticket type", value: b.ticketType === "return" ? "Return" : "Single" },
      { label: "Price paid", value: pounds(b.farePence) },
      { label: "Journey date", value: first.departure.slice(0, 10) },
      { label: "From", value: first.origin },
      { label: "To", value: last.destination },
      { label: "Scheduled departure", value: first.departure.slice(11) },
      { label: "Scheduled arrival", value: outcome.scheduledArrival },
      { label: "Actual arrival", value: outcome.actualArrival },
      { label: "Delay (minutes)", value: String(outcome.delayMinutes) },
      { label: "Train company that caused the delay", value: outcome.operator },
      { label: "Expected compensation", value: pounds(outcome.assessment.refundPence) },
      { label: "Refund method", value: PAYOUT_LABEL[profile.payout] },
    ],
  };
}

export const claimPackText = (p: ClaimPack) => p.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
