// Station name (as printed on tickets/emails) → 3-letter CRS code used by National Rail data.
// Starter list of major stations; unknown names fail loudly instead of guessing.
// TODO: replace with the full station list from the National Rail knowledgebase.

const STATIONS: Record<string, string> = {
  "london euston": "EUS", "london kings cross": "KGX", "london st pancras": "STP",
  "london st pancras international": "STP", "london paddington": "PAD",
  "london waterloo": "WAT", "london victoria": "VIC", "london bridge": "LBG",
  "london liverpool street": "LST", "london marylebone": "MYB",
  "manchester piccadilly": "MAN", "manchester airport": "MIA", "stockport": "SPT",
  "birmingham new street": "BHM", "birmingham international": "BHI",
  "liverpool lime street": "LIV", "leeds": "LDS", "york": "YRK", "sheffield": "SHF",
  "newcastle": "NCL", "edinburgh": "EDB", "edinburgh waverley": "EDB",
  "glasgow central": "GLC", "glasgow queen street": "GLQ",
  "bristol temple meads": "BRI", "bath spa": "BTH", "cardiff central": "CDF",
  "reading": "RDG", "oxford": "OXF", "cambridge": "CBG", "brighton": "BTN",
  "exeter st davids": "EXD", "plymouth": "PLY", "southampton central": "SOU",
  "nottingham": "NOT", "derby": "DBY", "leicester": "LEI", "coventry": "COV",
  "milton keynes central": "MKC", "watford junction": "WFJ", "rugby": "RUG",
  "crewe": "CRE", "stafford": "STA", "stoke on trent": "SOT", "macclesfield": "MAC",
  "wolverhampton": "WVH", "preston": "PRE", "lancaster": "LAN", "carlisle": "CAR",
  "wigan north western": "WGN", "warrington bank quay": "WBQ", "chester": "CTR",
  "doncaster": "DON", "peterborough": "PBO", "norwich": "NRW", "ipswich": "IPS",
  "sandwell and dudley": "SAD",
};

export function normaliseStation(name: string): string {
  return name.toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\bstation\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function toCrs(name: string): string {
  if (/^[A-Z]{3}$/.test(name.trim())) return name.trim();
  const crs = STATIONS[normaliseStation(name)];
  if (!crs) throw new Error(`Unknown station: ${name}`);
  return crs;
}
