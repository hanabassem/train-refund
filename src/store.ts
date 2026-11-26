// Simple JSON-file store for one user (prototype). Swap for a database when multi-user.

import { readFile, writeFile, rename } from "node:fs/promises";
import type { Booking } from "./booking.ts";
import type { JourneyOutcome } from "./matcher.ts";
import type { Profile } from "./claimPack.ts";

export type ClaimStatus = "ready" | "submitted" | "paid" | "rejected";

export interface Claim {
  id: string;
  bookingRef: string;
  operator: string;
  expectedRefundPence: number;
  status: ClaimStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedJourney {
  booking: Booking;
  addedAt: string;
  checkedAt?: string;
  outcome?: JourneyOutcome;
}

export interface AppData {
  profile?: Profile;
  journeys: TrackedJourney[];
  claims: Claim[];
  google?: { refreshToken: string; lastSync?: string };
}

export const emptyData = (): AppData => ({ journeys: [], claims: [] });

export async function loadData(file: string): Promise<AppData> {
  try {
    return { ...emptyData(), ...JSON.parse(await readFile(file, "utf8")) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyData();
    throw e;
  }
}

export async function saveData(file: string, data: AppData): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);   // atomic: never leaves a half-written file
}

// Returns false if we already track this booking.
export function addBooking(data: AppData, booking: Booking, now = new Date()): boolean {
  if (data.journeys.some((j) => j.booking.reference === booking.reference)) return false;
  data.journeys.push({ booking, addedAt: now.toISOString() });
  return true;
}

// One claim per booking. Returns the claim and whether it is new.
export function addClaim(data: AppData, bookingRef: string,
                         outcome: JourneyOutcome & { status: "owed" }, now = new Date()) {
  const existing = data.claims.find((c) => c.bookingRef === bookingRef);
  if (existing) return { claim: existing, isNew: false };
  const claim: Claim = {
    id: crypto.randomUUID(), bookingRef, operator: outcome.operator,
    expectedRefundPence: outcome.assessment.refundPence, status: "ready",
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  data.claims.push(claim);
  return { claim, isNew: true };
}
