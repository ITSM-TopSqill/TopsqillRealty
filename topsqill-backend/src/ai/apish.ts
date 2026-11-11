import { checkUrl, FetchError } from "../common/safe-fetch";
import { videoEmbed, tourEmbed } from "../common/embeds";
import { env } from "../common/env";
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

export async function apishGet(path: string, params: Record<string, string>, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const q = new URLSearchParams({ ...params, raw: "0" });
  const res = await (opts.fetchImpl ?? fetch)(`${BASE}${path}?${q}`, {
    headers: { "x-api-key": env.APISH_API_KEY ?? "", accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (res.ok && body.success !== false) return { data: body, credits: Number(res.headers.get("x-credits-used") ?? body.credits_used ?? 1) };
  const why = typeof body.error === "string" ? body.error.slice(0, 160) : "";
  if (res.status === 401) throw new FetchError("api.sh refused the API key. Check APISH_API_KEY.");
  if (res.status === 402) throw new FetchError("api.sh credits are used up (or a spend limit was reached).");
  if (res.status === 403) throw new FetchError(`api.sh doesn’t allow this key to call ${path}.`);
  if (res.status === 404) throw new FetchError("api.sh says that listing doesn’t exist or isn’t public.");
  if (res.status === 429 || res.status === 503) throw new FetchError("api.sh is busy. Try again in a minute.");
  throw new FetchError(`api.sh couldn’t read the page (${res.status}${why ? `: ${why}` : ""}).`);
}

/** Fetches one link through api.sh and turns the answer into what the importer reads. */
export async function readViaApish(url: string, opts: { fetchImpl?: typeof fetch } = {}) {
  checkUrl(url);
  const { path, portal } = apishEndpointFor(url);
  const params: Record<string, string> = path === "/web/v1/page" ? { url, format: "text", country: "IN" } : { url };
  const { data, credits } = await apishGet(path, params, opts);
  return { page: pageFromApish(data, url), data: portal ? data : null, portal, credits };
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
        if (/^(raw|links|headings|credits_used|cached|fetched_at|success)$/.test(k)) continue;
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
  return {
    purpose,
    kind: /villa/.test(type) ? "Villa" : /plot|land/.test(type) ? "Plot" : /builder floor|independent floor|\bif\b/.test(type) ? "Builder floor"
      : /office/.test(type) ? "Office" : /shop|retail/.test(type) ? "Shop" : "Apartment",
    bhk: num("bedrooms", "bhk") ?? (Number(/(\d)\s*bhk/i.exec(type)?.[1]) || null),
    areaSqft: num("super_builtup_sqft", "builtup_sqft", "carpet_sqft", "covered_area", "carpet_area", "size_sqft", "area_sqft", "plot_area"),
    priceInr: purpose === "rent" ? num("rent", "price") : num("price", "price_min"),
    city: s("city").replace(/^./, (c) => c.toUpperCase()),
    locality: s("locality", "nb_locality", "location"),
    furnishing: /^(fully|furnished)/.test(furnishing) ? "Fully furnished" : /semi/.test(furnishing) ? "Semi-furnished" : furnishing ? "Unfurnished" : "",
    facing: s("facing") ? `${s("facing")} facing` : "",
    possession: /ready|immediate|resale/i.test(possession) ? "Ready to move" : possession ? "Under construction" : "",
    reraNumber: s("rera", "rera_number", "rera_id"),
    projectName: s("project_name", "society") || (project && typeof project.name === "string" ? project.name : ""),
    builder: s("builder", "developer"),
    amenities: Array.isArray(d.amenities) ? (d.amenities as unknown[]).map(String).map((a) => a.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())).slice(0, 15) : [],
  };
}

function label(k: string) { return k.replace(/_/g, " "); }
