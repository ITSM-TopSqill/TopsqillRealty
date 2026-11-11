import { tourEmbed, videoEmbed } from "../common/embeds";

/**
 * Reads a property web page without a browser: its text, structured data,
 * photos, video and 3D-tour links, and map location. No AI here; this is the
 * raw material the importer (and Claude, when available) works from.
 */
export type PageImage = { url: string; alt: string };
export type ReadPage = {
  url: string; title: string; description: string; text: string;
  jsonLd: Record<string, unknown>[]; images: PageImage[];
  videos: string[]; tours: string[]; lat: number | null; lng: number | null;
};

const SKIP_IMAGE = /(logo|icon|favicon|sprite|avatar|badge|whatsapp|wa-|phone|call|arrow|loader|loading|spinner|placeholder|blank|pixel|tracking|facebook|instagram|twitter|linkedin|youtube|google|play-?store|app-?store|qr|rera-logo|payment|visa|mastercard|star|rating|close|menu|flag|emoji|banner-ad)/i;

export function readPage(html: string, pageUrl: string): ReadPage {
  const base = baseOf(html, pageUrl);
  const abs = (u: string) => { try { return new URL(decode(u.trim()), base).toString(); } catch { return ""; } };
  const meta = (name: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, "i");
    const tag = html.match(re)?.[0];
    return tag ? decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? "") : "";
  };

  const title = meta("og:title") || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const description = meta("og:description") || meta("description");

  // Structured data (schema.org) is the most reliable source when a site has it.
  const jsonLd: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      const list = Array.isArray(v) ? v : v?.["@graph"] ? v["@graph"] : [v];
      for (const item of list) if (item && typeof item === "object") jsonLd.push(item);
    } catch { /* broken JSON-LD is common; skip it */ }
  }

  // Photos: share images first, then everything in page order.
  const seen = new Set<string>();
  const images: PageImage[] = [];
  const add = (raw: string, alt = "") => {
    const url = abs(raw);
    if (!url || !/^https?:/.test(url) || seen.has(url)) return;
    const path = url.split(/[?#]/)[0];
    if (/\.(svg|gif|ico)$/i.test(path) || SKIP_IMAGE.test(path.split("/").pop() ?? "")) return;
    if (!/\.(jpe?g|png|webp|avif)$/i.test(path) && !/(image|img|photo|media|upload|gallery|cdn)/i.test(url)) return;
    seen.add(url);
    images.push({ url, alt: decode(alt).trim().slice(0, 80) });
  };
  for (const k of ["og:image", "og:image:url", "twitter:image"]) if (meta(k)) add(meta(k));
  for (const item of jsonLd) for (const img of [item.image].flat()) {
    if (typeof img === "string") add(img);
    else if (img && typeof img === "object" && typeof (img as { url?: unknown }).url === "string") add((img as { url: string }).url);
  }
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (n: string) => tag.match(new RegExp(`\\s${n}=["']([^"']+)["']`, "i"))?.[1];
    const alt = attr("alt") ?? attr("title") ?? "";
    const srcset = attr("data-srcset") ?? attr("srcset");
    const best = srcset ? largestFromSrcset(srcset) : null;
    const src = best ?? attr("data-src") ?? attr("data-lazy-src") ?? attr("data-original") ?? attr("src");
    if (src && !src.startsWith("data:")) add(src, alt);
  }
  // Lightbox galleries link to the full-size photo.
  for (const m of html.matchAll(/<a\b[^>]+href=["']([^"']+\.(?:jpe?g|png|webp|avif)(?:\?[^"']*)?)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) add(m[1]);

  // Video and 3D tours: any link or embed on the page.
  const links = [...html.matchAll(/(?:src|href|data-src|data-video|data-url)=["']([^"']+)["']/gi)].map((m) => decode(m[1]));
  links.push(...[...html.matchAll(/https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com|my\.matterport\.com|kuula\.co|momento360\.com)[^\s"'<>)]+/gi)].map((m) => decode(m[0])));
  const videos = unique(links.map((l) => videoEmbed(l.startsWith("//") ? `https:${l}` : l)?.url).filter(Boolean) as string[]);
  const tours = unique(links.map((l) => {
    const t = tourEmbed(l.startsWith("//") ? `https:${l}` : l);
    return t && !t.provider.startsWith("youtube") ? t.url : null;
  }).filter(Boolean) as string[]);

  const { lat, lng } = coordsOf(html, jsonLd);
  return { url: pageUrl, title, description, text: textOf(html), jsonLd: jsonLd.slice(0, 10), images: images.slice(0, 40), videos: videos.slice(0, 5), tours: tours.slice(0, 3), lat, lng };
}

/** Visible text, with block elements on their own lines, so headings and figures stay apart. */
export function textOf(html: string): string {
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/td|\/th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(body).split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean)
    .filter((l, i, all) => l !== all[i - 1]).join("\n").slice(0, 30_000);
}

/** Map location from Google Maps embeds and links, schema.org geo, or meta tags. Only places in India are kept. */
export function coordsOf(html: string, jsonLd: Record<string, unknown>[] = []) {
  const found: [number, number][] = [];
  for (const item of jsonLd) {
    const geo = (item.geo ?? (item as { location?: { geo?: unknown } }).location?.geo) as { latitude?: unknown; longitude?: unknown } | undefined;
    if (geo?.latitude && geo?.longitude) found.push([Number(geo.latitude), Number(geo.longitude)]);
  }
  const text = decode(html);
  const metaLat = text.match(/(?:place:location:latitude|geo\.position)["'][^>]*content=["']([-\d.]+)[;,]?\s*([-\d.]+)?/i);
  if (metaLat?.[1] && metaLat?.[2]) found.push([Number(metaLat[1]), Number(metaLat[2])]);
  const lonMeta = text.match(/place:location:longitude["'][^>]*content=["']([-\d.]+)/i);
  if (metaLat?.[1] && !metaLat?.[2] && lonMeta) found.push([Number(metaLat[1]), Number(lonMeta[1])]);
  // A pin on Google Maps ("!3d lat !4d lng") beats the map's centre ("!2d lng !3d lat").
  for (const m of text.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)) found.push([Number(m[1]), Number(m[2])]);
  for (const m of text.matchAll(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/g)) found.push([Number(m[2]), Number(m[1])]);
  for (const m of text.matchAll(/maps[^"'\s]*[@?&=/](-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/g)) found.push([Number(m[1]), Number(m[2])]);
  for (const m of text.matchAll(/data-lat(?:itude)?=["'](-?\d+\.\d+)["'][^>]*data-(?:lng|lon|longitude)=["'](-?\d+\.\d+)["']/g)) found.push([Number(m[1]), Number(m[2])]);
  const inIndia = found.find(([la, ln]) => la > 6 && la < 37.5 && ln > 68 && ln < 98);
  return inIndia ? { lat: round(inIndia[0]), lng: round(inIndia[1]) } : { lat: null, lng: null };
}

function largestFromSrcset(srcset: string) {
  let best: string | null = null, bestW = -1;
  for (const part of srcset.split(",")) {
    const [u, d] = part.trim().split(/\s+/);
    const w = d ? parseFloat(d) * (d.endsWith("x") ? 1000 : 1) : 0;
    if (u && w >= bestW) { best = u; bestW = w; }
  }
  return best;
}

function baseOf(html: string, pageUrl: string) {
  const href = html.match(/<base[^>]+href=["']([^"']+)["']/i)?.[1];
  try { return href ? new URL(href, pageUrl).toString() : pageUrl; } catch { return pageUrl; }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", bull: "•", hellip: "…", rupee: "₹", times: "×", sup2: "²" };
export function decode(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const unique = <T,>(a: T[]) => [...new Set(a)];
const round = (n: number) => Math.round(n * 1e6) / 1e6;
