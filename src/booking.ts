// Commit 2: Booking model + parser for Trainline confirmation emails (plain-text body).
// Times are UK local ("2026-11-20T08:30"), matching what the email and National Rail data show.

import type { TicketType } from "./compensation.ts";

export interface Leg {
  operator: string;     // e.g. "Avanti West Coast"
  origin: string;       // station name as printed
  destination: string;
  departure: string;    // "YYYY-MM-DDTHH:MM", UK local time
  arrival: string;
}

export interface Booking {
  retailer: "Trainline";
  reference: string;    // booking / transaction reference
  ticketType: TicketType;
  farePence: number;
  legs: Leg[];          // more than one leg = connection; needed for missed-connection claims
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "20 Nov 2026" → "2026-11-20"
function isoDate(text: string): string {
  const m = text.match(/(\d{1,2})\s+([A-Z][a-z]{2})\w*\s+(\d{4})/);
  if (!m || !MONTHS[m[2]]) throw new Error(`Unrecognised date: ${text}`);
  return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
}

function field(body: string, label: string): string {
  const m = body.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"));
  if (!m) throw new Error(`Missing "${label}" in email`);
  return m[1].trim();
}

// Leg lines look like: "08:30 London Euston → 10:41 Manchester Piccadilly (Avanti West Coast)"
const LEG_LINE = /^(\d{2}:\d{2})\s+(.+?)\s+(?:→|->)\s+(\d{2}:\d{2})\s+(.+?)\s+\((.+)\)\s*$/gm;

export function parseTrainlineEmail(body: string): Booking {
  const date = isoDate(field(body, "Travel date"));
  const fare = field(body, "Total paid").match(/£\s*(\d+)\.(\d{2})/);
  if (!fare) throw new Error("Missing fare");

  const legs = [...body.matchAll(LEG_LINE)].map(([, dep, origin, arr, destination, operator]) => ({
    operator, origin, destination,
    departure: `${date}T${dep}`,
    arrival: `${date}T${arr}`,
  }));
  if (legs.length === 0) throw new Error("No journey legs found");

  return {
    retailer: "Trainline",
    reference: field(body, "Booking reference"),
    ticketType: /return/i.test(field(body, "Ticket type")) ? "return" : "single",
    farePence: Number(fare[1]) * 100 + Number(fare[2]),
    legs,
  };
}
