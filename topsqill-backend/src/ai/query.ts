/**
 * Reads a plain-English (or Hinglish) property question without AI:
 * "3 bhk in sector 65 gurgaon under 2.5 cr", "2BHK rent Powai below 60k".
 * The assistant uses it when AI is unavailable, so search still works.
 */
export type ParsedQuery = {
  bhk?: number; minPrice?: number; maxPrice?: number; purpose?: "sale" | "rent";
  city?: string; kind?: string; areaSqft?: number; rest: string;
};

export const CITIES: [RegExp, string][] = [
  [/\bgreater noida\b/i, "Greater Noida"], [/\bnoida\b/i, "Noida"], [/\b(gurgaon|gurugram|ggn)\b/i, "Gurgaon"],
  [/\b(new )?delhi\b/i, "Delhi"], [/\bfaridabad\b/i, "Faridabad"], [/\b(mumbai|bombay)\b/i, "Mumbai"],
  [/\bpune\b/i, "Pune"], [/\b(bengaluru|bangalore|blr)\b/i, "Bengaluru"], [/\bhyderabad\b/i, "Hyderabad"],
];
const KINDS: [RegExp, string][] = [
  [/\bvillas?\b/i, "Villa"], [/\bplots?\b/i, "Plot"], [/\boffices?\b/i, "Office"], [/\bshops?\b/i, "Shop"],
  [/\bbuilder ?floors?\b/i, "Builder floor"], [/\b(apartments?|flats?)\b/i, "Apartment"],
];

/** "2.5 cr" → 25000000, "80 lakh" → 8000000, "60k" → 60000. */
export function money(n: string, unit?: string) {
  const v = parseFloat(n.replace(/,/g, ""));
  if (!isFinite(v)) return undefined;
  const u = (unit ?? "").toLowerCase();
  if (/^(cr|crore|crores)$/.test(u)) return Math.round(v * 1e7);
  if (/^(l|lac|lacs|lakh|lakhs)$/.test(u)) return Math.round(v * 1e5);
  if (u === "k") return Math.round(v * 1e3);
  return Math.round(v);
}

const AMOUNT = String.raw`₹?\s*([\d.,]+)\s*(cr|crores?|l|lacs?|lakhs?|k)?\b`;

export function parseQuery(text: string): ParsedQuery {
  let rest = ` ${text} `;
  const out: ParsedQuery = { rest: "" };
  const take = (re: RegExp) => { const m = rest.match(re); if (m) rest = rest.replace(m[0], " "); return m; };

  const bhk = take(/\b(\d)\s*-?\s*(bhk|bed(room)?s?|rk)\b/i);
  if (bhk) out.bhk = Number(bhk[1]);
  const between = take(new RegExp(String.raw`\bbetween\s+${AMOUNT}\s+(?:and|to|-)\s+${AMOUNT}`, "i"));
  if (between) { out.minPrice = money(between[1], between[2] ?? between[4]); out.maxPrice = money(between[3], between[4]); }
  const max = take(new RegExp(String.raw`\b(under|below|upto|up to|within|max|less than|budget(?: of)?)\s+${AMOUNT}`, "i"));
  if (max) out.maxPrice = money(max[2], max[3]);
  const min = take(new RegExp(String.raw`\b(above|over|more than|min|minimum|from)\s+${AMOUNT}`, "i"));
  if (min) out.minPrice = money(min[2], min[3]);
  const area = take(/\b([\d,]{3,6})\s*(sq\.?\s*ft|sqft|square feet|sft)\b/i);
  if (area) out.areaSqft = money(area[1]);
  if (/\b(rent|rental|lease|tenant|on rent|kiraye)\b/i.test(rest)) out.purpose = "rent";
  else if (/\b(buy|sale|purchase|resale)\b/i.test(rest)) out.purpose = "sale";
  for (const [re, city] of CITIES) if (re.test(rest)) { out.city = city; rest = rest.replace(re, " "); break; }
  for (const [re, kind] of KINDS) if (re.test(rest)) { out.kind = kind; rest = rest.replace(re, " "); break; }
  // Leftover small words are not part of a place name.
  out.rest = rest
    .replace(/\b(show|me|find|search|looking|look|for|want|need|i|a|an|the|in|at|near|around|on|to|rent|buy|sale|purchase|homes?|property|properties|listings?|please|any|some|with|and|of|under|budget|ready|move|what|is|are|price|rate|worth|how|much)\b/gi, " ")
    .replace(/[?,.!]/g, " ").replace(/\s+/g, " ").trim();
  return out;
}

/** What the member is asking for, roughly. */
export type Intent = "listings" | "people" | "price" | "jobs" | "leads" | "requirements" | "write";
export function intentOf(text: string): Intent {
  const t = text.toLowerCase();
  if (/^\s*(write|draft|compose|create a post|make a post|caption|rewrite)\b/.test(t)) return "write";
  if (/\bmy leads?\b|\bleads? (today|this week)\b|\bfollow ?ups?\b/.test(t)) return "leads";
  if (/\bmy requirements?\b/.test(t)) return "requirements";
  if (/\b(jobs?|hiring|vacanc|openings?|career)\b/.test(t)) return "jobs";
  if (/\b(price|rate|worth|value|valuation|per sq|psf|trend|appreciation|how much)\b/.test(t)) return "price";
  if (/\b(dealers?|agents?|brokers?|builders?|developers?|consultants?|people|who)\b/.test(t)) return "people";
  return "listings";
}

/** Monthly EMI for a home loan. */
export function emi(principal: number, ratePct = 8.5, years = 20) {
  const r = ratePct / 1200, n = years * 12;
  return Math.round((principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

/** ₹2.35 Cr, ₹85 L, ₹45,000. */
export function inr(n?: number | null) {
  if (!n) return "price on request";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, "")} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}
