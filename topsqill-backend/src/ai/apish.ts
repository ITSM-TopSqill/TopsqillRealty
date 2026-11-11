import { checkUrl, FetchError } from "../common/safe-fetch";
import { videoEmbed, tourEmbed } from "../common/embeds";
import { apishKeys, type KeyPool } from "../common/key-pool";
import type { ReadPage, PageImage } from "./page-reader";

/**
 * api.sh: a web-data API with ready-made endpoints for 99acres, MagicBricks
 * and NoBroker (the listing comes back as clean fields: price, BHK, areas,
 * photos, location...), and /web/v1/page for any other link.
 * Auth is the x-api-key header; every call is a GET; 1 credit per success
 * (2 for a MagicBricks project). Docs: https://api.sh/docs
 */
const BASE = "https://api.api.sh";

/** Which api.sh endpoint reads this link. Portal links get their own; anything else is read as a page. */
export function apishEndpointFor(raw: string): { path: string; portal: string | null } {
  const u = new URL(raw);
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host.endsWith("99acres.com") && /-spid-/i.test(u.pathname)) return { path: "/99acres/v1/listing", portal: "99acres" };
  if (host.endsWith("magicbricks.com") && /propertydetails/i.test(u.pathname + u.search)) return { path: "/magicbricks/v1/listing", portal: "MagicBricks" };
  if (host.endsWith("magicbricks.com") && /-pdpid-/i.test(u.pathname)) return { path: "/magicbricks/v1/project", portal: "MagicBricks" };
  if (host.endsWith("nobroker.in") && /\/property\//i.test(u.pathname)) return { path: "/nobroker/v1/listing", portal: "NoBroker" };
  return { path: "/web/v1/page", portal: null };
}

/**
 * One GET to api.sh, trying each usable key in turn: a refused key or one
 * out of credits is set aside and the next is tried (api.sh doesn't charge
 * for those refusals). Any other answer is final.
 */
export async function apishGet(path: string, params: Record<string, string>, opts: { fetchImpl?: typeof fetch; timeoutMs?: number; keys?: KeyPool } = {}) {
  const pool = opts.keys ?? apishKeys;
  const keys = await pool.usable();
  if (!keys.length) {
    throw new FetchError((await pool.all()).length
      ? "Every api.sh key is out of credits or was refused. Add a working key, then use Reload keys on Admin → AI."
      : "No api.sh key is set.");
  }
  const q = new URLSearchParams({ ...params, raw: "0" });
  let last: FetchError | null = null;
  for (const key of keys) {
    const res = await (opts.fetchImpl ?? fetch)(`${BASE}${path}?${q}`, {
      headers: { "x-api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.ok && body.success !== false) return { data: body, credits: Number(res.headers.get("x-credits-used") ?? body.credits_used ?? 1), key: `…${key.slice(-4)}` };
    const why = typeof body.error === "string" ? body.error.slice(0, 160) : "";
    if (res.status === 401 || res.status === 403) { pool.setAside(key, "rejected", why || `HTTP ${res.status}`); last = new FetchError("api.sh refused the API key."); continue; }
    if (res.status === 402) { pool.setAside(key, "no-credits", why || "out of credits"); last = new FetchError("api.sh credits are used up (or a spend limit was reached)."); continue; }
    if (res.status === 404) throw new FetchError("api.sh says that listing doesn’t exist or isn’t public.");
    if (res.status === 429 || res.status === 503) throw new FetchError("api.sh is busy. Try again in a minute.");
    throw new FetchError(`api.sh couldn’t read the page (${res.status}${why ? `: ${why}` : ""}).`);
  }
  throw new FetchError(`${last?.message ?? "api.sh failed."} No other key worked either.`);
}

/** Fetches one link through api.sh and turns the answer into what the importer reads. */
export async function readViaApish(url: string, opts: { fetchImpl?: typeof fetch; keys?: KeyPool } = {}) {
  checkUrl(url);
  const { path, portal } = apishEndpointFor(url);
  const params: Record<string, string> = path === "/web/v1/page" ? { url, format: "text", country: "IN" } : { url };
  const { data, credits, key } = await apishGet(path, params, opts);
  return { page: pageFromApish(data, url), data: portal ? data : null, portal, credits, key };
}

/** api.sh's JSON as a ReadPage: title, text (every field as "name: value" for portals), photos, map, video and tours. */
export function pageFromApish(data: Record<string, unknown>, url: string): ReadPage {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const images: PageImage[] = [];
  const seen = new Set<string>();
  const strings: string[] = [];
  const coords: { lat?: number; lng?: number } = {};
  const lines: string[] = [];

  const walk = (v: unknown, key: string, depth: number) => {
    if (depth > 6 || v == null) return;
    if (Array.isArray(v)) { v.slice(0, 80).forEach((x) => walk(x, key, depth + 1)); return; }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      // An image object: { url, alt } or { src, caption }
      const img = str(o.url) || str(o.src) || str(o.image) || str(o.large) || str(o.original);
      if (img && /image|photo|img|picture|gallery/i.test(key) && /^https?:/.test(img)) addImage(img, str(o.alt) || str(o.caption) || str(o.label));
      for (const [k, x] of Object.entries(o)) {
        // Who posted it (owner or agent name, photo, phone) is never taken in.
        if (/^(raw|links|headings|credits_used|cached|fetched_at|success)$/.test(k) || PERSONAL.test(k)) continue;
        walk(x, k, depth + 1);
      }
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      if (/^lat(itude)?$/i.test(key) && typeof v === "number") coords.lat ??= v;
      if (/^(lng|lon|long|longitude)$/i.test(key) && typeof v === "number") coords.lng ??= v;
      if (depth <= 2 && key !== "content") lines.push(`${label(key)}: ${v}`);
      return;
    }
    const s = String(v);
    strings.push(s);
    if (/^https?:\/\/\S+\.(jpe?g|png|webp|avif)(\?\S*)?$/i.test(s) || (/image|photo|img|picture|gallery/i.test(key) && /^https?:\/\/\S+$/.test(s))) { addImage(s, ""); return; }
    if (/^https?:/.test(s)) return;
    if (key !== "content" && depth <= 3 && s.length < 600) lines.push(`${label(key)}: ${s}`);
  };
  const addImage = (u: string, alt: string) => {
    const clean = u.trim();
    if (seen.has(clean) || /\.(svg|gif|ico)(\?|$)/i.test(clean) || /logo|icon|sprite|placeholder|avatar/i.test(clean)) return;
    seen.add(clean);
    images.push({ url: clean, alt: alt.slice(0, 80) });
  };
  walk(data, "", 0);

  const content = str(data.content);
  const title = str(data.title) || str(data.heading);
  const description = str(data.description) || str(data.summary);
  const text = [title, description, content, lines.join("\n")].filter(Boolean).join("\n").slice(0, 30_000);
  const inIndia = coords.lat != null && coords.lng != null && coords.lat > 6 && coords.lat < 37.5 && coords.lng > 68 && coords.lng < 98;
  return {
    url, title, description, text, jsonLd: [], images: images.slice(0, 40),
    videos: [...new Set(strings.map((s) => videoEmbed(s)?.url).filter(Boolean) as string[])].slice(0, 5),
    tours: [...new Set(strings.map((s) => { const t = tourEmbed(s); return t && !t.provider.startsWith("youtube") ? t.url : null; }).filter(Boolean) as string[])].slice(0, 3),
    lat: inIndia ? coords.lat! : null, lng: inIndia ? coords.lng! : null,
  };
}

/** Fields about the person who posted a listing: never read, stored or sent to the AI. */
const PERSONAL = /^(advertiser|owner|owner_name|agent|agents|contact|contacts|seller|dealer|broker|posted_by|poster|user|phone|phones|mobile|email|whatsapp|profile)$/i;

/** A RERA registration number has letters and digits ("UPRERAPRJ123456", "P51800046724"); "RERA" or "Yes" is a placeholder. */
export function validRera(v: string) {
  const t = v.replace(/^rera\s*(no\.?|number|id)?\s*[:#-]?\s*/i, "").trim();
  return /\d{3,}/.test(t) && /^[A-Z0-9/\-]{6,40}$/i.test(t) ? t : "";
}

/**
 * The facts a portal listing states outright (99acres, MagicBricks, NoBroker),
 * read straight from api.sh's fields. These beat any guess from page text.
 */
export function portalFacts(d: Record<string, unknown>) {
  const num = (...keys: string[]) => { for (const k of keys) { const v = Number(d[k]); if (Number.isFinite(v) && v > 0) return Math.round(v); } return null; };
  const s = (...keys: string[]) => { for (const k of keys) if (typeof d[k] === "string" && (d[k] as string).trim()) return (d[k] as string).trim(); return ""; };
  const type = `${s("type", "type_group", "building_type")} ${s("title")}`.toLowerCase();
  const kindRaw = `${s("kind", "purpose")}`.toLowerCase();
  const purpose: "sale" | "rent" = /rent|lease/.test(kindRaw) || (d.rent != null && d.price == null) ? "rent" : "sale";
  const furnishing = s("furnishing").toLowerCase();
  const possession = s("possession", "availability", "transaction");
  const project = d.project && typeof d.project === "object" ? (d.project as Record<string, unknown>) : null;
  // String lists from several fields, tidied ("SWIMMING_POOL" → "Swimming pool"), without repeats.
  const list = (...keys: string[]) => {
    const out: string[] = [];
    for (const k of keys) if (Array.isArray(d[k])) for (const v of d[k] as unknown[]) {
      const t = (typeof v === "string" ? v : typeof v === "object" && v && "name" in v ? String((v as { name: unknown }).name) : "").replace(/_/g, " ").trim();
      const nice = t === t.toUpperCase() ? t.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : t;
      if (nice && nice.length < 60 && !out.some((o) => o.toLowerCase() === nice.toLowerCase())) out.push(nice);
    }
    return out;
  };
  return {
    purpose,
    kind: /villa/.test(type) ? "Villa" : /plot|land/.test(type) ? "Plot" : /builder floor|independent floor|\bif\b/.test(type) ? "Builder floor"
      : /office/.test(type) ? "Office" : /shop|retail/.test(type) ? "Shop" : "Apartment",
    bhk: num("bedrooms", "bhk") ?? (Number(/(\d)\s*bhk/i.exec(type)?.[1]) || null),
    areaSqft: num("super_builtup_sqft", "builtup_sqft", "carpet_sqft", "covered_area", "carpet_area", "size_sqft", "area_sqft", "plot_area"),
    priceInr: purpose === "rent" ? num("rent", "price") : num("price", "price_min"),
    city: s("city").replace(/^./, (c) => c.toUpperCase()),
    // "Sector 49, Noida" → "Sector 49": the city is its own field.
    locality: s("locality", "nb_locality", "location").replace(new RegExp(`\\s*,\\s*${(s("city") || "#").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), ""),
    furnishing: /^(fully|furnished)/.test(furnishing) ? "Fully furnished" : /semi/.test(furnishing) ? "Semi-furnished" : furnishing ? "Unfurnished" : "",
    facing: s("facing") ? `${s("facing")} facing` : "",
    possession: /ready|immediate|resale/i.test(possession) ? "Ready to move" : possession ? "Under construction" : "",
    reraNumber: validRera(s("rera", "rera_number", "rera_id")),
    projectName: s("project_name", "society") || (project && typeof project.name === "string" ? project.name : ""),
    builder: s("builder", "developer"),
    amenities: list("amenities", "internal_features", "external_features", "features").slice(0, 15),
    // The nearest places first (exact distances beat "Close to Metro Station"), then the portal's own highlights ("Noida Sector 76 Metro Station, 0.65 km").
    usps: [...nearest(d.nearby), ...list("usps", "highlights")].filter((u, i, a) => a.findIndex((x) => x.toLowerCase() === u.toLowerCase()) === i).slice(0, 6),
    floor: num("floor") && num("total_floors") ? `${ordinal(num("floor")!)} floor of ${num("total_floors")}` : s("floors_label"),
  };
}

/** The two nearest places from a portal's "nearby" list, as short selling points. */
function nearest(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n) => n && typeof n === "object" && typeof (n as { name?: unknown }).name === "string")
    .map((n) => n as { name: string; distance?: string | number; category?: string })
    // What buyers ask about first: transit, then schools, hospitals and malls; then distance.
    .map((n) => ({ n, rank: [/metro|rapid|rrts/i, /railway|station|airport/i, /school|college|university/i, /hospital/i, /mall|market|shopping/i]
      .findIndex((re) => re.test(`${n.category ?? ""} ${n.name}`)) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (parseFloat(String(a.n.distance)) || 99) - (parseFloat(String(b.n.distance)) || 99))
    .map((x) => x.n)
    .slice(0, 2)
    .map((n) => `${n.name.replace(/\b\w/g, (c) => c.toUpperCase())}${n.distance ? `, ${n.distance}` : ""}`.slice(0, 80));
}

function ordinal(n: number) { const t = n % 100; return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`; }

function label(k: string) { return k.replace(/_/g, " "); }
