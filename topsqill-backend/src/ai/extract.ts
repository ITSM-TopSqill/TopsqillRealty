/**
 * Reads an Indian project page or brochure without AI.
 * This runs first and always: it gives a usable listing even when the AI is
 * unavailable, and its results are merged with the AI's for the best of both.
 */
export type Config = { bhk: number; sbua: number; sbuaMax?: number; carpet: number; price: number; estimated?: boolean };
export type Extracted = {
  name: string; builder: string; city: string; locality: string; reraNumber: string;
  status: string; possession: string; acres: number; towers: number; floors: number; units: number;
  openArea: number; paymentPlan: string; facing: string[]; amenities: string[]; specs: string[];
  configs: Config[]; nearby: { name: string; km: number; icon: string }[]; priceEstimated: boolean;
};

const CITIES = ["Greater Noida West", "Greater Noida", "Noida", "Gurgaon", "Gurugram", "Faridabad", "Ghaziabad", "New Delhi", "Delhi",
  "Navi Mumbai", "Thane", "Mumbai", "Pune", "Bengaluru", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur"];
const CITY_FIX: Record<string, string> = { Gurugram: "Gurgaon", "New Delhi": "Delhi", Bangalore: "Bengaluru" };
const AMENITIES: [RegExp, string][] = [
  [/infinity pool/i, "Infinity pool"], [/swimming pool|\bpool\b/i, "Swimming pool"], [/club ?house/i, "Clubhouse"],
  [/gym|fitness/i, "Gym"], [/golf/i, "Golf"], [/tennis/i, "Tennis court"], [/badminton/i, "Badminton court"],
  [/cricket/i, "Cricket pitch"], [/sports arena|sports/i, "Sports arena"], [/jogging|running track/i, "Jogging track"],
  [/kids.{0,8}play|play (?:area|zone)/i, "Kids’ play area"], [/yoga|meditation/i, "Yoga and meditation"],
  [/spa|salon/i, "Spa and salon"], [/co-?working/i, "Co-working lounge"], [/library/i, "Library"],
  [/amphitheat|open.?air theat/i, "Amphitheatre"], [/ev charging/i, "EV charging"], [/power backup/i, "Power backup"],
  [/security/i, "Gated security"], [/banquet/i, "Banquet hall"], [/restaurant|cafe/i, "Restaurant"],
  [/landscap|lawn|garden/i, "Landscaped gardens"], [/rooftop/i, "Rooftop deck"],
];
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function extractProject(url: string, rawText: string): Extracted {
  // Square metres are common on Indian builder sites; convert before anything else.
  const text = (rawText || "").replace(/\s+/g, " ")
    .replace(/([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*mtrs?\.?|sq\.?\s*met(?:er|re)s?|sqm\b|square met(?:er|re)s?)/gi,
      (_m, n) => Math.round(parseFloat(String(n).replace(/,/g, "")) * 10.764).toLocaleString("en-IN") + " sq ft");

  const path = decodeURIComponent((url || "").split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/, "")).replace(/[\/_-]+/g, " ");
  const hay = path + " " + text;

  const city0 = CITIES.find((c) => new RegExp("\\b" + c.replace(/ /g, "\\s+") + "\\b", "i").test(hay)) ?? "";
  const city = CITY_FIX[city0] ?? city0;
  const locality = (hay.match(/\b(Sector\s*[- ]?\s*[A-Z0-9]{1,6}|Phase\s*\d+|[A-Z][a-z]+\s+Expressway)\b/i)?.[1] ?? "").replace(/\s+/g, " ").trim();

  // Name: from the last part of the URL (the project slug), then "X by Y" in the text.
  const slug = decodeURIComponent((url || "").split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop() ?? "")
    .replace(/\.\w+$/, "").replace(/[_-]+/g, " ").trim();
  let name = "";
  if (slug) {
    const words: string[] = [];
    for (const w of slug.split(/\s+/)) {
      if (!w) continue;
      if (/^\d/.test(w) || /^(sector|sec|phase|apartments?|projects?|property|in|at|by|the|greater|new)$/i.test(w)) break;
      if (city && city.toLowerCase().split(" ").includes(w.toLowerCase())) break;
      words.push(w[0].toUpperCase() + w.slice(1));
    }
    name = words.join(" ");
  }
  if (!name) name = text.match(/^(.{3,60}?)\s+by\s+/i)?.[1]?.trim() ?? "";
  if (!name) name = "New residential project";

  let builder = text.match(/\bby\s+([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,3})/)?.[1] ?? "";
  if (!builder) {
    const host = (url.match(/^https?:\/\/([^/]+)/)?.[1] ?? "").replace(/^www\./, "");
    if (host) builder = host.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
  }
  builder = builder.replace(/\s+(Sector|Phase|Block|Plot|Presents?)$/i, "").trim();

  const reraIdx = text.search(/RERA/i);
  const reraNumber = reraIdx < 0 ? "" : (text.slice(reraIdx + 4, reraIdx + 80).match(/\b([A-Z]{2,}[A-Z0-9/-]*\d{3,}[A-Z0-9/-]*)/)?.[1] ?? "");

  const num = (re: RegExp) => Number(text.match(re)?.[1]?.replace(/,/g, "") ?? 0);
  const towersMatch = text.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[\w-]+\s+){0,3}towers?\b/i);
  const towers = towersMatch ? (WORD_NUM[towersMatch[1].toLowerCase()] ?? Number(towersMatch[1])) : 0;

  // Configurations: with a price first, then sizes alone (price marked as an estimate later).
  const configs: Config[] = [];
  const withPrice = /(\d)\s*BHK[^₹]{0,100}?([\d,]{3,6})\s*sq\.?\s*ft(?:[^₹]{0,60}?carpet\s*([\d,]{3,5}))?[^₹]{0,60}?₹\s*([\d.]+)\s*(cr|crore|l|lakh|lac)/gi;
  for (const m of text.matchAll(withPrice)) {
    const bhk = Number(m[1]);
    if (bhk < 1 || bhk > 6 || configs.some((c) => c.bhk === bhk)) continue;
    const sbua = Number(m[2].replace(/,/g, ""));
    configs.push({ bhk, sbua, carpet: m[3] ? Number(m[3].replace(/,/g, "")) : Math.round(sbua * 0.68),
      price: Math.round(parseFloat(m[4]) * (/^c/i.test(m[5]) ? 1e7 : 1e5)) });
  }
  if (!configs.length) {
    const sizeOnly = /(\d)\s*BHK[^₹]{0,60}?([\d,]{3,6})\s*sq\.?\s*ft(?:\s*(?:to|-|–)\s*([\d,]{3,6})\s*sq\.?\s*ft)?/gi;
    for (const m of text.matchAll(sizeOnly)) {
      const bhk = Number(m[1]);
      if (bhk < 1 || bhk > 6 || configs.some((c) => c.bhk === bhk)) continue;
      const sbua = Number(m[2].replace(/,/g, ""));
      const sbuaMax = m[3] ? Number(m[3].replace(/,/g, "")) : 0;
      configs.push({ bhk, sbua, sbuaMax: sbuaMax > sbua ? sbuaMax : undefined, carpet: Math.round(sbua * 0.7), price: 0, estimated: true });
    }
  }

  // "Fortis Hospital: 5.1 Km" style distance lists on builder pages.
  const nearby = [...text.matchAll(/([A-Z][A-Za-z0-9 .&'’()-]{2,48}?):\s*([\d.]+)\s*Km\b/g)]
    .map((m) => {
      const n = m[1].split(/\s[-•–]\s/).pop()!.trim();
      const l = n.toLowerCase();
      const icon = /metro/.test(l) ? "🚇" : /airport/.test(l) ? "✈️" : /hospital|medical/.test(l) ? "🏥"
        : /school|university|college/.test(l) ? "🏫" : /mall|market|plaza/.test(l) ? "🛍️"
        : /business|industrial|it park|office|tech/.test(l) ? "💼" : "📍";
      return { name: n, km: Number(m[2]), icon };
    })
    .filter((p) => p.km > 0 && p.km < 90)
    .slice(0, 10);

  // Amenity words inside the distance list would be false positives, so remove it first.
  const amenityHay = text.replace(/[A-Z][A-Za-z0-9 .&'’()-]{2,48}?:\s*[\d.]+\s*Km\b/g, "");
  const amenities = AMENITIES.filter(([re]) => re.test(amenityHay)).map(([, label]) => label)
    .filter((a, i, arr) => arr.indexOf(a) === i && !(a === "Swimming pool" && arr.includes("Infinity pool")))
    .slice(0, 12);

  const specs = (text.match(/specifications?:([^.]*)/i)?.[1] ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 2).slice(0, 8);
  const facing = [...new Set([...text.matchAll(/\b(east|north|west|south)\b(?=[\w\s,and]{0,25}facing)/gi)].map((m) => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()))];

  return {
    name, builder: builder || "", city, locality,
    reraNumber,
    status: /ready to move/i.test(text) ? "Ready to move" : /new launch|pre-?launch|launch date/i.test(text) ? "New launch" : "Under construction",
    possession: text.match(/possession[^A-Za-z0-9]{0,6}(?:by\s+|in\s+)?((?:[A-Z][a-z]+\s+)?\d{4})/i)?.[1] ?? "",
    acres: num(/([\d.]+)\s*acres?/i), towers,
    floors: num(/G\s*\+\s*(\d+)/i) || num(/(\d+)[\s-]*(?:storey|storeys|story|stories)/i),
    units: num(/([\d,]+)\s*units/i), openArea: num(/(\d+)%\s*open/i),
    paymentPlan: text.match(/(\d{2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?)/)?.[1] ?? "",
    facing: facing.length ? facing : ["East"],
    amenities, specs, configs, nearby,
    priceEstimated: configs.some((c) => c.estimated) || !configs.length,
  };
}

/** Fills in missing prices from the locality rate, clearly marked as estimates. */
export function estimatePrices(configs: Config[], ratePerSqft: number): Config[] {
  if (!configs.length) {
    return [2, 3, 4].map((bhk) => {
      const sbua = bhk * 560 + 150;
      return { bhk, sbua, carpet: Math.round(sbua * 0.68), price: Math.round((sbua * ratePerSqft) / 1e5) * 1e5, estimated: true };
    });
  }
  return configs.map((c) => (c.price > 0 ? c : { ...c, price: Math.round((c.sbua * ratePerSqft) / 1e5) * 1e5, estimated: true }));
}
