import { Injectable, Inject, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { DB, type Database } from "../db/db.module";
import { aiUsage } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { safeFetch, checkUrl, FetchError } from "../common/safe-fetch";
import { readPage, type ReadPage } from "./page-reader";
import { newId } from "../common/ids";
import { env } from "../common/env";
import { apishEndpointFor, readViaApish } from "./apish";
import { apishKeys } from "../common/key-pool";

export type FetchedPage = {
  page: ReadPage | null; via: "direct" | "brightdata" | "apish" | null; error: string;
  /** A portal listing's own fields (api.sh), when the link was a 99acres, MagicBricks or NoBroker listing. */
  data?: Record<string, unknown> | null; portal?: string | null;
};

/** Fewer characters than this and the page is a block screen or an empty shell built later in the browser. */
const THIN = 600;
/** Paid fetches (api.sh or Bright Data) per member per day. */
const PAID_PER_MEMBER = Number(process.env.SCRAPER_DAILY_LIMIT_PER_MEMBER ?? process.env.BRIGHTDATA_DAILY_LIMIT_PER_MEMBER ?? 20);

/**
 * Opens a page a member pasted, for the importers.
 *
 * Our own server tries first: free, and enough for most builder sites. Large
 * portals block servers or build the page in the browser, so a paid provider
 * reads those, when its key is set:
 * - api.sh (preferred): 99acres, MagicBricks and NoBroker listings come back
 *   as clean fields (price, BHK, areas, photos, location) and are read through
 *   it straight away; any other link goes through its page reader.
 * - Bright Data Web Unlocker: returns any page as a visitor would see it.
 * Each paid fetch is counted per member and recorded in ai_usage
 * ("fetch.apish" or "fetch.brightdata"), so the cost shows in Admin → AI.
 */
@Injectable()
export class PageFetcher {
  private readonly log = new Logger("page-fetch");
  constructor(@Inject(DB) private readonly db: Database, private readonly cache: CacheService) {}

  /** Which paid reader is set up, if any. */
  get provider(): "apish" | "brightdata" | null {
    if (apishKeys.configured) return "apish";
    if (env.BRIGHTDATA_API_KEY && env.BRIGHTDATA_ZONE) return "brightdata";
    return null;
  }
  get unlockerAvailable() { return this.provider !== null; }

  /** `paid: false` skips the paid readers (the member already pasted the page text). */
  async fetch(userId: string, url: string, opts: { paid?: boolean } = {}): Promise<FetchedPage> {
    const provider = opts.paid === false ? null : this.provider;
    // Portal listings: api.sh's fields beat anything we could read from the page, and the portal blocks us anyway.
    if (provider === "apish") {
      try { checkUrl(url); } catch (e) { return { page: null, via: null, error: (e as Error).message }; }
      if (apishEndpointFor(url).portal) return this.paid(userId, url, "apish", null, "");
    }

    let direct: ReadPage | null = null;
    let error = "";
    try {
      const res = await safeFetch(url, { maxBytes: 4_000_000, timeoutMs: 15_000 });
      if (res.contentType && !/html|xml|text\/plain/.test(res.contentType)) throw new FetchError("That link isn’t a web page.");
      direct = readPage(res.body.toString("utf8"), res.url);
    } catch (e) {
      error = e instanceof FetchError ? e.message : "The page couldn’t be opened.";
      // A private address or a non-page is refused outright, never retried elsewhere.
      if (/private address|isn’t a web page|unusual port|Only http|username or password/.test(error)) return { page: null, via: null, error };
    }
    if (direct && textLength(direct) >= THIN) return { page: direct, via: "direct", error: "" };
    if (!provider) return { page: direct, via: direct ? "direct" : null, error };
    return this.paid(userId, url, provider, direct, error);
  }

  private async paid(userId: string, url: string, provider: "apish" | "brightdata", direct: ReadPage | null, directError: string): Promise<FetchedPage> {
    await this.quota(userId);
    const started = Date.now();
    try {
      let page: ReadPage, data: Record<string, unknown> | null = null, portal: string | null = null;
      if (provider === "apish") ({ page, data, portal } = await readViaApish(url));
      else page = readPage(await unlock(url), url);
      await this.record(userId, provider, Date.now() - started, true);
      // Keep whichever version has more to read (a portal's own fields always win).
      if (!data && direct && textLength(direct) >= textLength(page)) return { page: direct, via: "direct", error: "" };
      return { page, via: provider, error: "", data, portal };
    } catch (e) {
      await this.record(userId, provider, Date.now() - started, false);
      this.log.warn(`${provider} failed for ${new URL(url).hostname}: ${(e as Error).message.slice(0, 160)}`);
      return { page: direct, via: direct ? "direct" : null, error: directError || (e as Error).message };
    }
  }

  private async quota(userId: string) {
    const key = `scrape:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = await this.cache.redis.incr(key).catch(() => 0);
    if (n === 1) await this.cache.redis.expire(key, 86_400).catch(() => {});
    if (n > PAID_PER_MEMBER) {
      throw new HttpException(`You’ve used today’s ${PAID_PER_MEMBER} imports from protected sites. Paste the page text instead, or try again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async record(userId: string, provider: "apish" | "brightdata", ms: number, ok: boolean) {
    await this.db.insert(aiUsage).values({
      id: newId(), userId, feature: `fetch.${provider}`, model: provider === "apish" ? "api.sh" : "brightdata-unlocker",
      inputTokens: 0, outputTokens: 0, ms, ok,
    }).catch(() => {});
  }
}

function textLength(p: ReadPage) { return [p.title, p.description, p.text].join(" ").replace(/\s+/g, " ").length; }

/**
 * One page through Bright Data's Web Unlocker API (direct API access):
 * POST https://api.brightdata.com/request { zone, url, format: "raw" }.
 * The address was already checked, and Bright Data fetches it from its own
 * network, so nothing here can reach our private network.
 */
export async function unlock(url: string, opts: { timeoutMs?: number; maxBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  checkUrl(url);
  const res = await (opts.fetchImpl ?? fetch)("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.BRIGHTDATA_API_KEY}` },
    body: JSON.stringify({ zone: env.BRIGHTDATA_ZONE, url, format: "raw" }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (res.status === 401 || res.status === 403) throw new FetchError("Bright Data refused the API key or zone. Check BRIGHTDATA_API_KEY and BRIGHTDATA_ZONE.");
  if (res.status === 402) throw new FetchError("Bright Data credits are used up for this month.");
  const brdError = res.headers.get("x-brd-error") ?? res.headers.get("x-luminati-error");
  if (!res.ok || brdError) throw new FetchError(`Bright Data couldn’t open the page (${res.status}${brdError ? `: ${brdError.slice(0, 120)}` : ""}).`);
  const max = opts.maxBytes ?? 6_000_000;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new FetchError("That page is too large to import.");
  return buf.toString("utf8");
}
