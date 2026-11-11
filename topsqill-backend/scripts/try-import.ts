/**
 * Tries the listing importer on real links from your own machine, without a
 * database or the website: what our server gets directly, and what the paid
 * reader (api.sh, or Bright Data) gets for sites that block it.
 *
 *   npx tsx scripts/try-import.ts "https://www.99acres.com/...-spid-..." "https://housing.com/..."
 *
 * Keys are read from ~/.topsqill/apish.key (or APISH_API_KEY) and
 * ~/.topsqill/brightdata.key (or BRIGHTDATA_API_KEY + BRIGHTDATA_ZONE), and
 * are never printed. api.sh is used when its key is there. Each paid read
 * uses one credit (two for a MagicBricks project).
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const keyFile = (name: string) => { const f = join(homedir(), ".topsqill", name); return existsSync(f) ? readFileSync(f, "utf8").trim() : ""; };
process.env.APISH_API_KEY ||= keyFile("apish.key");
process.env.BRIGHTDATA_API_KEY ||= keyFile("brightdata.key");
process.env.BRIGHTDATA_ZONE ||= "topsqill_unlocker";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.JWT_SECRET ??= "local-script-only-secret";

async function main() {
  const { safeFetch, cleanUrl } = await import("../src/common/safe-fetch");
  const { readPage } = await import("../src/ai/page-reader");
  const { unlock } = await import("../src/ai/page-fetcher.service");
  const { readViaApish, apishEndpointFor } = await import("../src/ai/apish");
  const { ListingImportService } = await import("../src/ai/listing-import.service");
  const svc = new ListingImportService({} as never, {} as never, {} as never);
  const provider = process.env.APISH_API_KEY ? "api.sh" : process.env.BRIGHTDATA_API_KEY ? "Bright Data" : null;
  console.log(`Paid reader: ${provider ?? "none (only direct fetches)"}`);

  for (const raw of process.argv.slice(2)) {
    const url = cleanUrl(raw);
    console.log(`\n${url}`);
    let page = null as ReturnType<typeof readPage> | null, data: Record<string, unknown> | null = null, via = "direct";
    const portal = provider === "api.sh" && apishEndpointFor(url).portal;
    if (!portal) {
      try { const res = await safeFetch(url, { maxBytes: 4_000_000, timeoutMs: 15_000 }); page = readPage(res.body.toString("utf8"), res.url); }
      catch (e) { console.log(`  direct: ${(e as Error).message}`); }
    }
    const thin = !page || [page.title, page.text].join(" ").length < 600;
    if (thin && provider) {
      try {
        if (provider === "api.sh") {
          const r = await readViaApish(url);
          page = r.page; data = r.data; via = `api.sh ${apishEndpointFor(url).path} (${r.credits} credit${r.credits === 1 ? "" : "s"})`;
        } else { page = readPage(await unlock(url), url); via = "Bright Data"; }
      } catch (e) { console.log(`  ${provider}: ${(e as Error).message}`); }
    }
    if (!page) { console.log("  nothing to read: paste the page text in the importer instead"); continue; }
    const text = [page.title, page.description, page.text].join("\n");
    const base = svc.rules(url, page, text);
    const d = data ? svc.withPortalFacts(base, data) : base;
    console.log(`  via ${via}: ${text.length} characters, ${page.images.length} photos, ${page.videos.length} videos, ${page.tours.length} 3D tours, map ${page.lat != null ? `${page.lat}, ${page.lng}` : "no"}`);
    console.log(`  title: ${d.title}`);
    console.log(`  ${d.purpose} · ${d.kind} · ${d.city || "?"} / ${d.locality || "?"} · ${d.bhk ?? "?"} BHK · ${d.areaSqft ?? "?"} sq ft · ₹${d.priceInr?.toLocaleString("en-IN") ?? "?"}`);
    console.log(`  ${[d.furnishing, d.facing, d.possession, d.reraNumber && `RERA ${d.reraNumber}`, d.projectName].filter(Boolean).join(" · ")}`);
    if (d.amenities.length) console.log(`  amenities: ${d.amenities.slice(0, 8).join(", ")}`);
    if (page.images[0]) console.log(`  first photo: ${page.images[0].url.slice(0, 100)}`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
