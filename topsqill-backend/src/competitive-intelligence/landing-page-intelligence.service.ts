import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { competitorLandingPageAnalyses, competitors } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";
import { PageFetcher } from "../ai/page-fetcher.service";
import { checkUrl, FetchError } from "../common/safe-fetch";

const MIN_TEXT_LENGTH = 200;
const MAX_MANUAL_TEXT = 12_000;

type Breakdown = {
  headline: string; subheadline: string; keyMessages: string[]; offers: string[]; ctas: string[];
  trustSignals: string[]; pricingMentioned: string | null; formFields: string[]; confidence: "low" | "medium" | "high";
};

/**
 * Landing Page Intelligence (Module 4): a real, structured AI breakdown of
 * a competitor's landing page - messaging, offers, CTAs, trust signals and
 * whatever it asks a visitor for - fed from real page text, never
 * invented. The page's own text isn't stored, only the structured read, so
 * nothing here can be mistaken for a quote of the page itself unless it's
 * one of the exact strings the model pulled out.
 *
 * Two ways in, same as the ad-creative analyser: `analyse` fetches the
 * page itself (our own server, then a paid unlocker if one's configured -
 * see PageFetcher), and `analyseManual` takes text a member pasted by hand
 * for pages that block automated readers entirely. Never falls back to a
 * rules-based guess - AI off or a failed fetch means nothing is saved.
 */
@Injectable()
export class LandingPageIntelligenceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly pageFetcher: PageFetcher,
  ) {}

  async analyse(userId: string, url: string, competitorId?: string) {
    let checked: URL;
    try { checked = checkUrl(url); } catch (e) { throw new BadRequestException(e instanceof FetchError ? e.message : "That doesn't look like a web link."); }
    await this.assertOwnsCompetitor(userId, competitorId);
    await this.assertAiEnabled();

    const fetched = await this.pageFetcher.fetch(userId, checked.toString());
    if (!fetched.page || !fetched.page.text || fetched.page.text.trim().length < MIN_TEXT_LENGTH) {
      throw new BadRequestException(
        fetched.error || "Couldn't read enough real text from that page - it may block automated readers. Paste the page's own text instead.",
      );
    }

    const corpus = [fetched.page.title, fetched.page.description, fetched.page.text].filter(Boolean).join("\n\n").slice(0, 12_000);
    return this.runAndSave(userId, competitorId, checked.toString(), fetched.page.title || null, corpus, "fetched");
  }

  /**
   * Analyse page text a member pasted by hand - for landing pages that
   * block automated readers (common for ad-driven funnels). No live fetch
   * happens here, so there's no URL validation beyond a loose format check
   * when one is given, purely for display.
   */
  async analyseManual(userId: string, text: string, url?: string, competitorId?: string) {
    const clean = text?.trim().slice(0, MAX_MANUAL_TEXT) ?? "";
    if (clean.length < MIN_TEXT_LENGTH) throw new BadRequestException(`Paste at least ${MIN_TEXT_LENGTH} characters of real page text - too little to analyse honestly.`);
    await this.assertOwnsCompetitor(userId, competitorId);
    await this.assertAiEnabled();

    let cleanUrl: string | null = null;
    if (url?.trim()) { try { cleanUrl = checkUrl(url).toString(); } catch { cleanUrl = url.trim().slice(0, 500); } }

    return this.runAndSave(userId, competitorId, cleanUrl, null, clean, "manual");
  }

  private async assertOwnsCompetitor(userId: string, competitorId?: string) {
    if (!competitorId) return;
    const [row] = await this.read.select({ id: competitors.id }).from(competitors)
      .where(and(eq(competitors.id, competitorId), eq(competitors.ownerId, userId))).limit(1);
    if (!row) throw new BadRequestException("That competitor could not be found.");
  }

  private async assertAiEnabled() {
    if (!(await this.claude.enabledFor("competitive-intelligence"))) {
      throw new BadRequestException("AI is off right now, so a landing-page analysis can't be generated.");
    }
  }

  private async runAndSave(userId: string, competitorId: string | undefined, url: string | null, pageTitle: string | null, corpus: string, inputSource: "fetched" | "manual") {
    const fallback = (): Breakdown => ({ headline: "", subheadline: "", keyMessages: [], offers: [], ctas: [], trustSignals: [], pricingMentioned: null, formFields: [], confidence: "low" });
    const { data, source } = await this.claude.json<Breakdown>(
      `This is the real text of a competitor's landing page${inputSource === "manual" ? " (pasted in by hand)" : " (fetched live)"}:\n${corpus}\n\n` +
      `Only what's actually in the text above is real - no traffic, conversion rate, bounce rate or sales figure is available or should be mentioned (that data isn't on a landing page). ` +
      `Write a structured breakdown, quoting or closely paraphrasing only what's actually present:\n` +
      `- headline: the main headline/hero message, as close to verbatim as reasonable.\n` +
      `- subheadline: the supporting line under the headline, or "" if there isn't a clear one.\n` +
      `- keyMessages: 2-5 short phrases capturing the core value propositions actually stated on the page.\n` +
      `- offers: any discounts, bundles, free trials, guarantees or limited-time offers actually mentioned - empty array if none.\n` +
      `- ctas: the actual call-to-action button/link text used (e.g. "Book a free demo", "Get started") - empty array if none found.\n` +
      `- trustSignals: testimonials, review counts, certifications, "as seen in" logos, guarantees, security badges etc. actually mentioned - empty array if none.\n` +
      `- pricingMentioned: a short honest description of what pricing info (if any) is shown - e.g. "Starts at $29/mo, shown openly" or "No pricing shown, must contact sales" - never invent a number not in the text.\n` +
      `- formFields: if there's a lead-capture or sign-up form, what it asks for (e.g. "name, email, phone") - empty array if no form is described in the text.\n` +
      `- confidence: "low"|"medium"|"high" - reflecting how complete and legible the page text actually was.\n` +
      `Reply with JSON only: {"headline":"","subheadline":"","keyMessages":[],"offers":[],"ctas":[],"trustSignals":[],"pricingMentioned":null,"formFields":[],"confidence":"low"}.`,
      fallback, { userId, feature: "competitive-intelligence", effort: "medium", maxTokens: 900 },
    );
    if (source !== "claude" || !data.headline?.trim()) {
      throw new BadRequestException("Couldn't generate a landing-page analysis right now - please try again shortly.");
    }

    const confidence = data.confidence === "high" || data.confidence === "medium" ? data.confidence : "low";
    const cap = (arr: unknown, n: number) => (Array.isArray(arr) ? arr.filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((s: string) => s.trim().slice(0, 200)) : []);

    const [row] = await this.db.insert(competitorLandingPageAnalyses).values({
      id: newId(), ownerId: userId, competitorId: competitorId ?? null, url: url?.slice(0, 500) ?? null, pageTitle: pageTitle?.slice(0, 300) ?? null,
      headline: data.headline.trim().slice(0, 300),
      subheadline: data.subheadline?.trim().slice(0, 300) || null,
      keyMessages: cap(data.keyMessages, 5), offers: cap(data.offers, 6), ctas: cap(data.ctas, 6), trustSignals: cap(data.trustSignals, 6),
      pricingMentioned: data.pricingMentioned?.trim().slice(0, 300) || null,
      formFields: cap(data.formFields, 10),
      confidence, source: "claude", inputSource,
    }).returning();
    return row;
  }

  async list(userId: string, competitorId?: string, limit = 20) {
    const cap = Math.min(Math.max(limit, 1), 50);
    const where = competitorId
      ? and(eq(competitorLandingPageAnalyses.ownerId, userId), eq(competitorLandingPageAnalyses.competitorId, competitorId))
      : eq(competitorLandingPageAnalyses.ownerId, userId);
    const rows = await this.read.select().from(competitorLandingPageAnalyses).where(where).orderBy(desc(competitorLandingPageAnalyses.createdAt)).limit(cap);
    return { items: rows };
  }
}
