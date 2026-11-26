// Commit 1: Delay Repay eligibility + compensation calculator.
// Pure logic, no network, no I/O — the core rule every later step depends on.
//
// Rule tiers below follow the published National Rail Delay Repay schemes.
// TEAM: verify each operator's scheme on its own Delay Repay page before launch.

export type Scheme = "DR15" | "DR30";
export type TicketType = "single" | "return";

export interface Journey {
  operator: string;          // e.g. "Avanti West Coast"
  ticketType: TicketType;
  farePence: number;         // total price paid for the ticket, in pence
  delayMinutes: number;      // arrival delay at destination
  cancelled: boolean;        // service cancelled (delay is then measured on the replacement arrival)
}

export interface Assessment {
  eligible: boolean;
  percentOfLegFare: number;  // 0, 25, 50 or 100
  refundPence: number;
  reason: string;
}

// Which scheme each operator uses. Start small; add operators as we support them.
export const OPERATOR_SCHEMES: Record<string, Scheme> = {
  "Avanti West Coast": "DR15",
  "Great Western Railway": "DR15",
  "LNER": "DR30",
  "Northern": "DR15",
  "TransPennine Express": "DR15",
};

// [minimum delay in minutes, % of single-leg fare]. Highest matching tier wins.
const TIERS: Record<Scheme, Array<[number, number]>> = {
  DR15: [[15, 25], [30, 50], [60, 100], [120, 100]],
  DR30: [[30, 50], [60, 100], [120, 100]],
};

export function assess(j: Journey): Assessment {
  const scheme = OPERATOR_SCHEMES[j.operator];
  if (!scheme) {
    return { eligible: false, percentOfLegFare: 0, refundPence: 0,
             reason: `Operator not supported yet: ${j.operator}` };
  }

  const tier = [...TIERS[scheme]].reverse().find(([min]) => j.delayMinutes >= min);
  if (!tier) {
    return { eligible: false, percentOfLegFare: 0, refundPence: 0,
             reason: `${j.delayMinutes} min is below the ${scheme} threshold` };
  }

  const [minDelay, percent] = tier;
  // A return ticket's leg is worth half the fare, except 120+ min refunds the whole return.
  const base =
    j.ticketType === "return" && minDelay < 120 ? j.farePence / 2 : j.farePence;
  const refundPence = Math.floor((base * percent) / 100);

  return { eligible: true, percentOfLegFare: percent, refundPence,
           reason: `${scheme}: ${j.delayMinutes} min delay → ${percent}%` };
}
