// Booking → HSP → compensation. Decides whether a journey is owed money.
// Delay Repay is measured at the FINAL destination. If a train was cancelled or a
// connection was missed, we can't know which later train the passenger caught,
// so we ask them for their actual arrival time instead of guessing.

import type { Booking, Leg } from "./booking.ts";
import { findArrival, type ArrivalResult, type HspConfig } from "./hsp.ts";
import { assess, OPERATOR_SCHEMES, type Assessment } from "./compensation.ts";
import { toCrs } from "./stations.ts";

export interface LegResult { leg: Leg; arrival: ArrivalResult }

export type JourneyOutcome =
  | { status: "owed"; operator: string; delayMinutes: number; scheduledArrival: string;
      actualArrival: string; assessment: Assessment; legs: LegResult[] }
  | { status: "not_owed"; delayMinutes: number; reason: string; legs: LegResult[] }
  | { status: "needs_arrival_time"; operator: string; reason: string; legs: LegResult[] }
  | { status: "unknown"; reason: string; legs: LegResult[] };

export const MIN_CONNECTION_MINUTES = 5;

// "YYYY-MM-DDTHH:MM" (UK local, treated as a plain clock time) ↔ minutes
export const toMin = (dt: string) => Date.parse(`${dt}:00Z`) / 60000;
const hhmm = (min: number) => new Date(min * 60000).toISOString().slice(11, 16);

function decide(b: Booking, operator: string, delayMinutes: number, cancelled: boolean,
                legs: LegResult[]): JourneyOutcome {
  if (!OPERATOR_SCHEMES[operator]) {
    return { status: "unknown", reason: `Operator not supported yet: ${operator}`, legs };
  }
  const scheduled = toMin(b.legs[b.legs.length - 1].arrival);
  const assessment = assess({ operator, ticketType: b.ticketType, farePence: b.farePence,
                              delayMinutes, cancelled });
  return assessment.eligible
    ? { status: "owed", operator, delayMinutes, scheduledArrival: hhmm(scheduled),
        actualArrival: hhmm(scheduled + delayMinutes), assessment, legs }
    : { status: "not_owed", delayMinutes, reason: assessment.reason, legs };
}

export async function checkBooking(b: Booking, hsp: HspConfig): Promise<JourneyOutcome> {
  const legs: LegResult[] = [];
  for (let i = 0; i < b.legs.length; i++) {
    const leg = b.legs[i];
    let arrival: ArrivalResult;
    try {
      arrival = await findArrival(hsp, { fromCrs: toCrs(leg.origin), toCrs: toCrs(leg.destination),
                                         departure: leg.departure });
    } catch (e) {
      return { status: "unknown", reason: (e as Error).message, legs };
    }
    legs.push({ leg, arrival });

    if (arrival.status === "not_found") return { status: "unknown", reason: arrival.detail, legs };
    if (arrival.status === "cancelled") {
      return { status: "needs_arrival_time", operator: leg.operator, legs,
               reason: `The ${leg.departure.slice(11)} ${leg.origin} → ${leg.destination} train was cancelled` };
    }
    const next = b.legs[i + 1];
    if (next && toMin(leg.arrival) + arrival.delayMinutes + MIN_CONNECTION_MINUTES > toMin(next.departure)) {
      return { status: "needs_arrival_time", operator: leg.operator, legs,
               reason: `Delay of ${arrival.delayMinutes} min at ${leg.destination} likely made you miss the ${next.departure.slice(11)} connection` };
    }
  }

  const last = legs[legs.length - 1];
  const delay = last.arrival.status === "arrived" ? last.arrival.delayMinutes : 0;
  return decide(b, last.leg.operator, delay, false, legs);
}

// Passenger tells us when they actually reached their final destination ("HH:MM").
export function resolveWithArrivalTime(b: Booking, outcome: JourneyOutcome & { status: "needs_arrival_time" },
                                       actual: string): JourneyOutcome {
  if (!/^\d{2}:\d{2}$/.test(actual)) throw new Error("Arrival time must be HH:MM");
  const scheduled = toMin(b.legs[b.legs.length - 1].arrival);
  let arrivedAt = toMin(`${b.legs[b.legs.length - 1].arrival.slice(0, 10)}T${actual}`);
  if (arrivedAt < scheduled - 720) arrivedAt += 1440;   // after midnight
  const delay = Math.max(0, arrivedAt - scheduled);
  const cancelled = outcome.legs.some((l) => l.arrival.status === "cancelled");
  return decide(b, outcome.operator, delay, cancelled, outcome.legs);
}
