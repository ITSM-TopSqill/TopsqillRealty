import { Injectable, Inject, Logger, HttpException, HttpStatus } from "@nestjs/common";
import { DB, type Database } from "../db/db.module";
import { aiUsage } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { safeFetch, checkUrl, FetchError } from "../common/safe-fetch";
import { readPage, type ReadPage } from "./page-reader";
import { newId } from "../common/ids";
import { env } from "../common/env";

export type FetchedPage = { page: ReadPage | null; via: "direct" | "brightdata" | null; error: string };

/** Fewer characters than this and the page is a block screen or an empty shell built later in the browser. */
const THIN = 600;
/** Bright Data fetches per member per day; each one is a paid request. */
const UNLOCKER_PER_MEMBER = Number(process.env.BRIGHTDATA_DAILY_LIMIT_PER_MEMBER ?? 20);

/**
 * Opens a page a member pasted, for the importers.
 *
 * Our own server tries first: free, and enough for most builder sites. Large
 * portals (99acres, Housing.com, MagicBricks...) block servers or build the
 * page in the browser; for those, when a Bright Data Web Unlocker key is set,
 * the page is fetched once more through Bright Data, which returns the page
 * as a visitor would see it. Each such fetch is counted per member and
 * recorded in ai_usage as "fetch.brightdata", so the cost shows in Admin → AI.
 */
@Injectable()
export class PageFetcher {
  private readonly log = new Logger("page-fetch");
  constructor(@Inject(DB) private readonly db: Database, private readonly cache: CacheService) {}

  get unlockerAvailable() { return !!env.BRIGHTDATA_API_KEY && !!env.BRIGHTDATA_ZONE; }

  /** `paid: false` skips Bright Data (the member already pasted the page text). */
  async fetch(userId: string, url: string, opts: { paid?: boolean } = {}): Promise<FetchedPage> {
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
    if (!this.unlockerAvailable || opts.paid === false) return { page: direct, via: direct ? "direct" : null, error };

    await this.quota(userId);
    const started = Date.now();
    try {
      const html = await unlock(url);
      const page = readPage(html, url);
      await this.record(userId, Date.now() - started, true);
      // Keep whichever version has more to read.
      if (direct && textLength(direct) >= textLength(page)) return { page: direct, via: "direct", error: "" };
      return { page, via: "brightdata", error: "" };
    } catch (e) {
      await this.record(userId, Date.now() - started, false);
      this.log.warn(`brightdata failed for ${new URL(url).hostname}: ${(e as Error).message.slice(0, 160)}`);
      return { page: direct, via: direct ? "direct" : null, error: error || (e as Error).message };
    }
  }

  private async quota(userId: string) {
    const key = `brightdata:${userId}:${new Date().toISOString().slice(0, 10)}`;
    const n = await this.cache.redis.incr(key).catch(() => 0);
    if (n === 1) await this.cache.redis.expire(key, 86_400).catch(() => {});
    if (n > UNLOCKER_PER_MEMBER) {
      throw new HttpException(`You’ve used today’s ${UNLOCKER_PER_MEMBER} imports from protected sites. Paste the page text instead, or try again tomorrow.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async record(userId: string, ms: number, ok: boolean) {
    await this.db.insert(aiUsage).values({ id: newId(), userId, feature: "fetch.brightdata", model: "brightdata-unlocker", inputTokens: 0, outputTokens: 0, ms, ok })
      .catch(() => {});
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
