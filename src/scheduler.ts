// Checks each journey once it should have arrived, creates claims, and notifies the passenger.

import type { HspConfig } from "./hsp.ts";
import { checkBooking, toMin } from "./matcher.ts";
import { claimDeadline } from "./claimPack.ts";
import { addClaim, type AppData, type Claim } from "./store.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spaces out HSP requests (Rail Data Marketplace allows ~1 request/second).
export function rateLimited(f: typeof fetch, gapMs = 1100): typeof fetch {
  let next = 0;
  let queue: Promise<void> = Promise.resolve();
  return ((...args: Parameters<typeof fetch>) => {
    const turn = queue.then(async () => {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + gapMs;
    });
    queue = turn;
    return turn.then(() => f(...args));
  }) as typeof fetch;
}

// Current UK local time as "YYYY-MM-DDTHH:MM" (handles GMT/BST).
export function ukLocalNow(now = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export interface Notifier { notify(title: string, body: string): Promise<void> }
export const consoleNotifier: Notifier = {
  async notify(title, body) { console.log(`[notify] ${title} — ${body}`); },
};

export interface RunOptions {
  hsp: HspConfig;
  now?: Date;
  notifier?: Notifier;
  settleMinutes?: number;           // wait after scheduled arrival before checking
  retryUnknownAfterMinutes?: number;
}

export async function runChecks(data: AppData, opts: RunOptions): Promise<{ checked: number; newClaims: Claim[] }> {
  const now = opts.now ?? new Date();
  const notifier = opts.notifier ?? consoleNotifier;
  const local = ukLocalNow(now);
  const nowMin = toMin(local);
  const newClaims: Claim[] = [];
  let checked = 0;

  for (const j of data.journeys) {
    if (j.outcome && j.outcome.status !== "unknown") continue;      // already decided
    if (j.outcome && j.checkedAt &&
        now.getTime() - Date.parse(j.checkedAt) < (opts.retryUnknownAfterMinutes ?? 360) * 60000) continue;
    const lastArrival = j.booking.legs[j.booking.legs.length - 1].arrival;
    if (nowMin < toMin(lastArrival) + (opts.settleMinutes ?? 60)) continue;  // not arrived yet
    if (claimDeadline(j.booking) < local.slice(0, 10)) continue;              // too late to claim

    const outcome = await checkBooking(j.booking, opts.hsp);
    j.outcome = outcome;
    j.checkedAt = now.toISOString();
    checked++;

    if (outcome.status === "owed") {
      const { claim, isNew } = addClaim(data, j.booking.reference, outcome, now);
      if (isNew) {
        newClaims.push(claim);
        await notifier.notify(`You're owed £${(claim.expectedRefundPence / 100).toFixed(2)}`,
          `${outcome.operator} was ${outcome.delayMinutes} min late. Tap to claim before ${claimDeadline(j.booking)}.`);
      }
    } else if (outcome.status === "needs_arrival_time") {
      await notifier.notify("When did you arrive?", `${outcome.reason}. Tell us your arrival time to claim.`);
    }
  }
  return { checked, newClaims };
}
