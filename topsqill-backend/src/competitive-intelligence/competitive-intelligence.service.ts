import { Injectable, BadRequestException } from "@nestjs/common";
import { env } from "../common/env";
import { ClaudeService } from "../ai/claude.service";
import { searchAdLibrary, AdLibraryError, type AdLibraryResult } from "./ad-library";

export type PatternSummary = { available: true; text: string } | { available: false; reason: string };

/**
 * Competitive Intelligence (Section 2-3 of the Campaign Evolution spec),
 * scoped to what's honestly buildable: a real, on-demand search of Meta's
 * public Ad Library (the one source with a genuinely public API Topsqill
 * can call with its existing app credentials). Google Ads Transparency
 * Center, TikTok Creative Center and LinkedIn's ad library have no public
 * API - scraping them isn't attempted here.
 *
 * No persisted competitor monitoring (Section 11) is built - every search
 * is a live, on-demand call, never a scheduled background job.
 */
@Injectable()
export class CompetitiveIntelligenceService {
  constructor(private readonly claude: ClaudeService) {}

  async searchAds(userId: string, searchTerms: string, limit = 20) {
    let results: AdLibraryResult[];
    try {
      results = await searchAdLibrary({
        appId: env.META_APP_ID, appSecret: env.META_APP_SECRET, apiVersion: "v21.0",
        searchTerms, countries: ["IN"], limit,
      });
    } catch (e) {
      if (e instanceof AdLibraryError) throw new BadRequestException(e.message);
      throw e;
    }
    return { results, patterns: await this.summarisePatterns(userId, searchTerms, results) };
  }

  /**
   * An optional, clearly-labelled pattern summary across the real ad text
   * just returned - never a performance claim. Falls back to "no AI
   * summary" rather than hand-coding pattern-matching rules that would
   * read as more confident than they are.
   */
  private async summarisePatterns(userId: string, searchTerms: string, results: AdLibraryResult[]): Promise<PatternSummary> {
    if (!results.length) return { available: false, reason: "No ads found to summarise." };
    if (!(await this.claude.enabledFor("competitive-intelligence"))) return { available: false, reason: "AI is off, so no pattern summary - the raw ad list above is still real." };

    const corpus = results.slice(0, 20).map((r, i) => `${i + 1}. ${r.pageName}: "${r.headline ?? ""}" — ${r.body ?? ""}`).join("\n");
    const prompt = `These are real, currently or recently running Meta ads found for the search "${searchTerms}":\n${corpus}\n\n` +
      `Identify 2-4 real patterns across these ads (repeated messaging angles, offers, CTAs, formats). These are patterns to consider testing, NOT proof any of them perform well - some ads may just be newly launched or poorly targeted. Never invent a conversion rate, CTR, budget or sales figure - none of that is in the data above. Plain text, under 120 words.`;
    const fallback = () => "AI is off right now - no pattern summary available.";
    const text = await this.claude.ask(prompt, { userId, feature: "competitive-intelligence", effort: "low", maxTokens: 400 }).catch(() => null);
    return text ? { available: true, text } : { available: false, reason: fallback() };
  }
}
