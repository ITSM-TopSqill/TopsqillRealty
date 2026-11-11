/**
 * Tries the listing importer on real links from your own machine, without a
 * database or the website: what our server gets directly, and what Bright
 * Data gets for sites that block it.
 *
 *   npx tsx scripts/try-import.ts "https://www.99acres.com/..." "https://housing.com/..."
 *
 * The Bright Data key is read from ~/.topsqill/brightdata.key (or the
 * BRIGHTDATA_API_KEY variable) and is never printed. The zone defaults to
 * topsqill_unlocker; set BRIGHTDATA_ZONE to use another. Each blocked link
 * uses one Bright Data request.
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const keyFile = join(homedir(), ".topsqill", "brightdata.key");
process.env.BRIGHTDATA_API_KEY ??= existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
process.env.BRIGHTDATA_ZONE ??= "topsqill_unlocker";
process.env.DATABASE_URL ??= "postgres://unused@localhost/unused";
process.env.JWT_SECRET ??= "local-script-only-secret";

async function main() {
  const { safeFetch, cleanUrl } = await import("../src/common/safe-fetch");
  const { readPage } = await import("../src/ai/page-reader");
  const { unlock } = await import("../src/ai/page-fetcher.service");
  const { ListingImportService } = await import("../src/ai/listing-import.service");
  const svc = new ListingImportService({} as never, {} as never, {} as never);
  const hasKey = !!process.env.BRIGHTDATA_API_KEY;
  console.log(`Bright Data: ${hasKey ? `key found, zone ${process.env.BRIGHTDATA_ZONE}` : "no key (only direct fetches)"}`);

  for (const raw of process.argv.slice(2)) {
    const url = cleanUrl(raw);
    console.log(`\n${url}`);
    let html = "", via = "direct";
    try {
      const res = await safeFetch(url, { maxBytes: 4_000_000, timeoutMs: 15_000 });
      html = res.body.toString("utf8");
    } catch (e) { console.log(`  direct: ${(e as Error).message}`); }
    const thin = (h: string) => { const p = readPage(h, url); return [p.title, p.text].join(" ").length < 600; };
    if ((!html || thin(html)) && hasKey) {
      try { html = await unlock(url); via = "Bright Data"; }
      catch (e) { console.log(`  Bright Data: ${(e as Error).message}`); }
    }
    if (!html) { console.log("  nothing to read: paste the page text in the importer instead"); continue; }
    const p = readPage(html, url);
    const text = [p.title, p.description, p.text].join("\n");
    const d = svc.rules(url, p, text);
    console.log(`  via ${via}: ${text.length} characters of text, ${p.images.length} photos, ${p.videos.length} videos, ${p.tours.length} 3D tours, map ${p.lat != null ? "yes" : "no"}`);
    console.log(`  title: ${p.title.slice(0, 100)}`);
    console.log(`  without AI: ${d.city || "?"} / ${d.locality || "?"} · ${d.configs.map((c) => `${c.bhk} BHK ${c.areaSqft} sq ft`).join(", ") || "no sizes"} · price ${d.priceInr ?? "?"}`);
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
