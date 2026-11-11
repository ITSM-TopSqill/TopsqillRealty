import { Injectable, BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import { ClaudeService } from "./claude.service";
import { CacheService } from "../redis/redis.module";
import { extractProject } from "./extract";
import { readPage, type PageImage, type ReadPage } from "./page-reader";
import { safeFetch, cleanUrl, FetchError } from "../common/safe-fetch";
import { videoEmbed, tourEmbed } from "../common/embeds";
import { money } from "./query";

export type ImportConfig = { bhk: number; areaSqft: number; priceInr: number; label: string; startingPrice?: boolean };
export type ImportDraft = {
  source: "claude" | "rules"; sourceUrl: string; site: string;
  title: string; purpose: "sale" | "rent"; kind: string; bhk: number | null; areaSqft: number | null;
  priceInr: number | null; priceOnRequest: boolean;
  city: string; locality: string; possession: string; furnishing: string; facing: string;
  description: string; amenities: string[]; usps: string[]; reraNumber: string;
  projectName: string; builder: string;
  lat: number | null; lng: number | null; locationExact: boolean;
  videoUrl: string; tourUrl: string;
  configs: ImportConfig[]; images: PageImage[]; notes: string[];
};

const KINDS = ["Apartment", "Builder floor", "Villa", "Plot", "Office", "Shop"];
const IMPORTS_PER_DAY = 40;

/**
 * "Import from a link": reads another listing or project page and drafts a
 * Topsqill listing from it. Nothing is published here: the member sees the
 * draft in the listing form, checks it, picks the photos they have the right
 * to use, and publishes it themselves.
 *
 * Facts come only from the page. The description is written fresh rather
 * than copied, and anything uncertain is reported back as a note.
 */
@Injectable()
export class ListingImportService {
  constructor(private readonly claude: ClaudeService, private readonly cache: CacheService) {}

  async preview(userId: string, input: { url: string; text?: string }): Promise<ImportDraft> {
    let url: string;
    try { url = cleanUrl(input.url); } catch (e) { throw new BadRequestException((e as Error).message); }
    await this.throttle(userId);

    let page: ReadPage | null = null;
    let fetchError = "";
    try {
      const res = await safeFetch(url, { maxBytes: 4_000_000, timeoutMs: 15_000 });
      if (!/html|xml|text\/plain/.test(res.contentType) && res.contentType) throw new FetchError("That link isn’t a web page.");
      page = readPage(res.body.toString("utf8"), res.url);
    } catch (e) {
      fetchError = e instanceof FetchError ? e.message : "The page couldn’t be opened.";
    }
    const pasted = (input.text ?? "").trim();
    const text = [page?.title, page?.description, page?.text, pasted].filter(Boolean).join("\n");
    if (text.replace(/\s+/g, " ").length < 200) {
      throw new BadRequestException(fetchError
        ? `${fetchError} Open the page in your browser, copy all of its text, and paste it in the box below the link.`
        : "That site shows almost nothing to robots. Open it in your browser, copy all of its text, and paste it in the box below the link.");
    }

    const rules = this.rules(url, page, text);
    const notes: string[] = [];
    if (fetchError) notes.push(`${fetchError} The draft uses only the text you pasted.`);

    const { data: ai, source } = await this.claude.json<Partial<AiDraft>>(this.prompt(url, page, text), () => ({}), {
      userId, feature: "listing.import", maxTokens: 2500, cacheSeconds: 3600, effort: "medium", timeoutMs: 60_000,
    });
    const draft = this.merge(rules, ai, source);
    draft.notes.unshift(...notes);

    // Map: the page's own pin when it has one; otherwise the locality's centre.
    if (draft.lat == null && draft.locality && draft.city) {
      const spot = await this.geocode(`${draft.locality}, ${draft.city}`);
      if (spot) { draft.lat = spot.lat; draft.lng = spot.lng; draft.locationExact = false; }
    }
    if (!draft.priceInr) draft.notes.push("The page doesn’t state a price. Add the price you are offering before publishing.");
    if (!draft.reraNumber && draft.purpose === "sale") draft.notes.push("No RERA number found on the page. Add it if the project is registered.");
    if (draft.images.length) draft.notes.push("Use only photos you have the right to publish, such as the builder’s marketing material shared with you as a channel partner.");
    return draft;
  }

  /** A limit per member per day, so the importer can't be used to crawl other sites. */
  private async throttle(userId: string) {
    const key = `import:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = await this.cache.redis.incr(key).catch(() => 0);
    if (n === 1) await this.cache.redis.expire(key, 86_400).catch(() => {});
    if (n > IMPORTS_PER_DAY) throw new HttpException(`You can import up to ${IMPORTS_PER_DAY} links a day. Try again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
  }

  /** The no-AI draft: pattern matching over the page text. Always computed, and the base the AI result is merged onto. */
  rules(url: string, page: ReadPage | null, text: string): ImportDraft {
    const x = extractProject(url, text);
    const host = new URL(url).hostname.replace(/^www\./, "");
    // The extractor names a project after the address when it finds nothing better; the page title is usually better.
    const fromTitle = (page?.title ?? "").split(/\s[|–—-]\s/)[0].trim();
    // A name made from the web address ("Www.m3m India") is no name at all.
    const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
    const fromHost = !x.name || /^www\b/i.test(x.name) || squash(host).startsWith(squash(x.name)) || squash(x.name).includes(squash(host.split(".")[0] === "www" ? host.split(".")[1] : host.split(".")[0]));
    const projectName = fromHost ? fromTitle : x.name;
    const city = pickCity(url, page?.title ?? "", text) || x.city;
    // The extractor's locality may belong to another city named in a menu; keep it only when the page pairs them.
    const locality = x.locality && (city === x.city || nearCity(text, x.locality, city)) ? x.locality : "";
    const rent = /\b(for rent|on rent|per month|\/month|monthly rent|lease)\b/i.test(text) && !/\bfor sale\b/i.test(text);
    const kind = /\bvilla\b/i.test(text) ? "Villa" : /\b(plot|land parcel for sale)\b/i.test(text) && !/apartment|flat|bhk/i.test(text) ? "Plot"
      : /builder floor|independent floor/i.test(text) ? "Builder floor" : /\boffice space\b/i.test(text) && !/bhk/i.test(text) ? "Office"
      : /\bshop\b|retail space/i.test(text) && !/bhk/i.test(text) ? "Shop" : "Apartment";

    // "Starting from ₹1.8 Cr" is the price of the smallest home.
    const start = text.match(/(?:starting|starts|onwards|from|price)\D{0,24}₹\s*([\d.,]+)\s*(cr|crores?|lakhs?|lacs?|l)\b/i)
      ?? text.match(/₹\s*([\d.,]+)\s*(cr|crores?|lakhs?|lacs?|l)\b/i);
    const startPrice = start ? money(start[1], start[2]) ?? 0 : 0;
    let configs: ImportConfig[] = x.configs.filter((c) => c.bhk >= 1 && c.sbua > 0).map((c) => ({
      bhk: c.bhk, areaSqft: c.sbua, priceInr: c.estimated ? 0 : c.price, label: `${c.bhk} BHK · ${c.sbua.toLocaleString("en-IN")} sq ft`,
    }));
    const cards = homeCards(text);
    if (cards.length > configs.length) configs = cards;
    if (startPrice && configs.length && !configs.some((c) => c.priceInr)) { configs[0].priceInr = startPrice; configs[0].startingPrice = true; }
    const first = configs[0];

    const usps: string[] = [];
    if (x.acres) usps.push(`${x.acres} acres${x.openArea ? `, ${x.openArea}% open green` : ""}`);
    if (x.towers) usps.push(`${x.towers} towers${x.floors ? ` of ${x.floors} floors` : ""}`);
    for (const n of x.nearby.slice(0, 2)) usps.push(`${n.km} km to ${n.name}`);
    usps.push(...x.amenities.slice(0, 3));

    const place = [locality, city].filter(Boolean).join(", ");
    const description = [
      `${projectName || "This project"}${x.builder && !projectName.toLowerCase().includes(x.builder.toLowerCase().split(/\s+/).slice(0, 2).join(" ")) ? ` by ${x.builder}` : ""} is ${x.status === "Ready to move" ? "a ready-to-move" : x.status === "New launch" ? "a newly launched" : "an under-construction"} residential project${place ? ` in ${place}` : ""}.`,
      x.acres || x.towers ? `It is spread over ${x.acres ? `${x.acres} acres` : "a large site"}${x.towers ? ` with ${x.towers} towers` : ""}${x.openArea ? ` and about ${x.openArea}% open area` : ""}.` : "",
      configs.length ? `Homes on offer: ${configs.map((c) => c.label).join("; ")}.` : "",
      x.amenities.length ? `Amenities include ${x.amenities.slice(0, 6).join(", ").toLowerCase()}.` : "",
      x.possession ? `Possession is expected in ${x.possession}.` : "",
    ].filter(Boolean).join(" ");

    return {
      source: "rules", sourceUrl: url, site: host,
      title: (first ? `${first.bhk} BHK ${kind === "Apartment" ? "apartment" : kind.toLowerCase()} in ` : `${kind} in `) + [projectName, locality || city].filter(Boolean).join(", "),
      purpose: rent ? "rent" : "sale", kind,
      bhk: first?.bhk ?? null, areaSqft: first?.areaSqft ?? null, priceInr: first?.priceInr || null,
      priceOnRequest: /price on request|on request|call for price/i.test(text) && !first?.priceInr,
      city, locality: locality || city, possession: x.status === "Ready to move" ? "Ready to move" : "Under construction",
      furnishing: /fully furnished/i.test(text) ? "Fully furnished" : /semi[- ]furnished/i.test(text) ? "Semi-furnished" : "Unfurnished",
      // Only when the page says so in as many words; "Vastu compliant" is not a direction.
      facing: text.match(/\b((?:north|south|east|west)(?:[- ](?:east|west))?|park|garden|road|pool)[- ]facing\b/i)?.[0].replace(/^./, (c) => c.toUpperCase()) ?? "",
      description, amenities: x.amenities, usps: usps.slice(0, 6), reraNumber: x.reraNumber,
      projectName, builder: x.builder,
      lat: page?.lat ?? null, lng: page?.lng ?? null, locationExact: page?.lat != null,
      videoUrl: page?.videos[0] ?? "", tourUrl: page?.tours[0] ?? "",
      configs, images: page?.images ?? [], notes: [],
    };
  }

  private prompt(url: string, page: ReadPage | null, text: string) {
    const ld = page?.jsonLd.length ? JSON.stringify(page.jsonLd).slice(0, 3000) : "none";
    return `You are turning a property web page into a draft listing for Topsqill.ai, an Indian real-estate network.
Read the page and return ONLY a JSON object with these keys:
{
 "projectName": "", "builder": "", "title": "max 90 chars, e.g. '3 BHK apartment in Leafsong Retreat, Sector MU'",
 "purpose": "sale" | "rent", "kind": one of ${JSON.stringify(KINDS)},
 "city": "", "locality": "sector or neighbourhood, e.g. 'Sector 150' or 'Golf Course Road'",
 "configs": [{"bhk": 3, "areaSqft": 1650, "priceInr": 18000000, "startingPrice": true, "label": "3 BHK + 2T · 1,650 sq ft"}],
 "possession": "Ready to move" | "Under construction", "possessionDate": "", "furnishing": "Unfurnished" | "Semi-furnished" | "Fully furnished",
 "facing": "", "reraNumber": "", "amenities": ["max 15, short names"],
 "usps": ["max 6 selling points, each under 9 words, only facts from the page"],
 "description": "90-140 words in your own words for buyers",
 "notes": ["anything a careful agent should double-check: conflicting figures, missing price, claims that need proof"]
}
Rules:
- Use only facts on the page. Leave a field "" or 0 or [] when the page doesn't say. Never guess a price or RERA number.
- Prices in rupees as integers (1.8 Cr = 18000000, 95 Lakh = 9500000). A "starting from" price belongs to the smallest home; set startingPrice true.
- Areas in square feet; convert square metres by multiplying by 10.764. One config per distinct home type, smallest first.
- Write the description fresh. Don't copy sentences from the page, don't include phone numbers, offers, discounts or "pre-launch" urgency, and never promise returns or appreciation.
- If the page contradicts itself (two different land areas, sizes or prices), use the more specific figure and say so in notes.
- Ignore enquiry forms, cookie text, disclaimers and navigation.

Page address: ${url}
Page title: ${page?.title ?? ""}
Structured data: ${ld}
Page text:
"""
${text.slice(0, 14_000)}
"""`;
  }

  /** The AI's answer wins field by field when it's usable; the rules fill every gap. */
  merge(base: ImportDraft, ai: Partial<AiDraft>, source: "claude" | "rules"): ImportDraft {
    const d: ImportDraft = { ...base, source, notes: [...base.notes] };
    const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : "");
    const list = (v: unknown, max: number, len = 80) => (Array.isArray(v) ? v.map((s) => str(s, len)).filter(Boolean).slice(0, max) : []);
    const configs = (Array.isArray(ai.configs) ? ai.configs : [])
      .map((c) => ({
        bhk: Math.round(Number(c?.bhk) || 0), areaSqft: Math.round(Number(c?.areaSqft) || 0),
        priceInr: Math.round(Number(c?.priceInr) || 0), startingPrice: !!c?.startingPrice,
        label: str(c?.label, 60),
      }))
      .filter((c) => c.areaSqft > 0 && c.areaSqft < 200_000 && c.bhk >= 0 && c.bhk <= 10 && c.priceInr >= 0 && c.priceInr < 5e10)
      .map((c) => ({ ...c, label: c.label || `${c.bhk ? `${c.bhk} BHK · ` : ""}${c.areaSqft.toLocaleString("en-IN")} sq ft` }))
      .sort((a, b) => a.areaSqft - b.areaSqft).slice(0, 12);
    if (configs.length) d.configs = configs;

    for (const k of ["projectName", "builder", "city", "locality", "facing", "reraNumber"] as const) {
      const v = str(ai[k], k === "locality" || k === "city" ? 120 : 160);
      if (v) d[k] = v;
    }
    const title = str(ai.title, 140);
    if (title) d.title = title;
    const desc = str(ai.description, 3000);
    if (desc) d.description = desc;
    if (ai.purpose === "sale" || ai.purpose === "rent") d.purpose = ai.purpose;
    if (typeof ai.kind === "string" && KINDS.includes(ai.kind)) d.kind = ai.kind;
    if (ai.possession === "Ready to move" || ai.possession === "Under construction") d.possession = ai.possession;
    if (ai.furnishing === "Unfurnished" || ai.furnishing === "Semi-furnished" || ai.furnishing === "Fully furnished") d.furnishing = ai.furnishing;
    const amenities = list(ai.amenities, 15, 40);
    if (amenities.length) d.amenities = amenities;
    const usps = list(ai.usps, 6, 80);
    if (usps.length) d.usps = usps;
    d.notes.push(...list(ai.notes, 5, 240));
    if (str(ai.possessionDate, 40) && d.possession === "Under construction") d.usps = d.usps.length < 6 ? [...d.usps, `Possession ${str(ai.possessionDate, 40)}`] : d.usps;

    const first = d.configs[0];
    if (first) { d.bhk = first.bhk || null; d.areaSqft = first.areaSqft; d.priceInr = first.priceInr || null; }
    if (d.priceInr) d.priceOnRequest = false;
    // Only links we can safely embed are kept.
    d.videoUrl = videoEmbed(d.videoUrl)?.url ?? "";
    d.tourUrl = tourEmbed(d.tourUrl)?.url ?? "";
    return d;
  }

  /** The centre of a locality, from OpenStreetMap, cached for a month. */
  private async geocode(q: string): Promise<{ lat: number; lng: number } | null> {
    const key = `geo:${q.toLowerCase()}`;
    const hit = await this.cache.get<{ lat: number; lng: number } | "none">(key);
    if (hit) return hit === "none" ? null : hit;
    try {
      const res = await safeFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`,
        { accept: "application/json", timeoutMs: 6000, maxBytes: 200_000 });
      const [first] = JSON.parse(res.body.toString("utf8")) as { lat: string; lon: string }[];
      const spot = first ? { lat: Number(first.lat), lng: Number(first.lon) } : null;
      await this.cache.set(key, spot ?? "none", spot ? 30 * 86_400 : 86_400);
      return spot;
    } catch { return null; }
  }
}

/**
 * Home-type cards ("3 BHK + 2 Toilets" then "SIZE • 1,650 Sq. Ft." a line or
 * two later), as most project pages list them. Long sentences are skipped, so
 * a size mentioned in passing ("a 25,000 sq ft clubhouse") isn't taken for a home.
 */
/**
 * The listing's city: one named in the link or the page title wins; otherwise
 * the city the page mentions most. (Menus and footers name many cities, so the
 * first one found is often wrong.)
 */
export function pickCity(url: string, title: string, text: string): string {
  const CITIES: [string, RegExp][] = [
    ["Greater Noida", /greater[\s-]*noida/gi], ["Noida", /(?<!greater[\s-]{0,3})\bnoida\b/gi], ["Gurgaon", /\bgurgaon\b|\bgurugram\b/gi],
    ["Delhi", /\b(?:new\s+)?delhi\b/gi], ["Faridabad", /\bfaridabad\b/gi], ["Ghaziabad", /\bghaziabad\b/gi],
    ["Navi Mumbai", /navi[\s-]*mumbai/gi], ["Thane", /\bthane\b/gi], ["Mumbai", /(?<!navi[\s-]{0,3})\bmumbai\b/gi], ["Pune", /\bpune\b/gi],
    ["Bengaluru", /\bbengaluru\b|\bbangalore\b/gi], ["Hyderabad", /\bhyderabad\b/gi], ["Chennai", /\bchennai\b/gi],
    ["Kolkata", /\bkolkata\b/gi], ["Ahmedabad", /\bahmedabad\b/gi], ["Jaipur", /\bjaipur\b/gi], ["Chandigarh", /\bchandigarh\b/gi],
    ["Mohali", /\bmohali\b/gi], ["Lucknow", /\blucknow\b/gi], ["Goa", /\bgoa\b/gi], ["Sonipat", /\bsonipat\b/gi],
  ];
  const head = decodeURIComponent(url).replace(/[-_/]+/g, " ") + " " + title;
  let best = "", bestScore = 0;
  for (const [name, re] of CITIES) {
    const inHead = (head.match(re) ?? []).length;
    const score = inHead * 1000 + (text.match(re) ?? []).length;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  return best;
}

/** True when the page names this locality close to this city ("Sector 49, Gurugram"). */
function nearCity(text: string, locality: string, city: string) {
  const at = text.toLowerCase().indexOf(locality.toLowerCase());
  for (let i = at; i >= 0; i = text.toLowerCase().indexOf(locality.toLowerCase(), i + 1)) {
    if (pickCity("", "", text.slice(Math.max(0, i - 80), i + locality.length + 80)) === city) return true;
  }
  return false;
}

export function homeCards(text: string): ImportConfig[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: ImportConfig[] = [];
  let bhk = 0, since = 99;
  for (const line of lines) {
    since++;
    const b = line.match(/\b(\d)\s*(?:BHK|bed(?:room)?s?)\b/i);
    if (b && line.length < 60) { bhk = Number(b[1]); since = 0; }
    const size = line.length < 60 ? line.match(/([\d,]{3,6})\s*(?:sq\.?\s*ft|sqft|sq\.?\s*feet|square feet)/i) : null;
    const area = size ? Number(size[1].replace(/,/g, "")) : 0;
    if (area >= 300 && area <= 15000 && bhk && since <= 3 && !out.some((c) => c.areaSqft === area)) {
      out.push({ bhk, areaSqft: area, priceInr: 0, label: `${bhk} BHK · ${area.toLocaleString("en-IN")} sq ft` });
    }
  }
  return out.sort((a, b) => a.areaSqft - b.areaSqft).slice(0, 12);
}

type AiDraft = {
  projectName: string; builder: string; title: string; purpose: string; kind: string; city: string; locality: string;
  configs: { bhk: number; areaSqft: number; priceInr: number; startingPrice?: boolean; label?: string }[];
  possession: string; possessionDate: string; furnishing: string; facing: string; reraNumber: string;
  amenities: string[]; usps: string[]; description: string; notes: string[];
};
