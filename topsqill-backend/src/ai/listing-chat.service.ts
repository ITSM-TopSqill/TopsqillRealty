import { Injectable, HttpException, Logger, NotFoundException } from "@nestjs/common";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeService, textOf } from "./claude.service";
import { ListingsService } from "../listings/listings.service";
import { SearchService } from "../search/search.service";
import { emi, inr } from "./query";
import type { Turn } from "./assistant.service";

const SYSTEM = `You answer a buyer's questions about ONE property listing on Topsqill.ai, an Indian real estate network.

Rules:
- Answer only from the FACTS given with the question. If the answer is not there (society rules, exact floor, maintenance charges, nearby schools, legal status...), say you don't have that detail and suggest asking the seller with the "Contact seller" button.
- Never invent numbers, places, or promises. Do not give legal or tax advice; you may explain what to check.
- Prices in Indian style (₹2.4 Cr, ₹85 L). Be warm and brief: 2 to 5 sentences, plain text, no headings or tables.
- When asked if the price is fair, compare the listing's rate per sq ft with the locality average and similar listings from the FACTS, and say what that means in one line.`;

type ListingRow = {
  id: string; title: string; purpose: string; kind: string; bhk?: number | null; areaSqft?: number | null; priceInr?: number | null;
  city: string; locality: string; possession?: string | null; furnishing?: string | null; facing?: string | null;
  description?: string | null; amenities?: string[]; usps?: string[]; verified?: boolean; reraNumber?: string | null;
  publishedAt?: string | Date | null; status?: string; media?: { label?: string | null }[];
};

/**
 * "Ask about this listing": answers come only from the listing, its locality's
 * numbers and similar listings, so the AI cannot make things up about a home.
 */
@Injectable()
export class ListingChatService {
  private readonly log = new Logger("listing-chat");

  constructor(private readonly claude: ClaudeService, private readonly listingsSvc: ListingsService, private readonly search: SearchService) {}

  async ask(userId: string, listingId: string, question: string, history: Turn[] = []) {
    const l = (await this.listingsSvc.getById(listingId).catch(() => null)) as unknown as ListingRow | null;
    if (!l) throw new NotFoundException("That listing is no longer available.");
    const facts = await this.factsFor(l);

    if (this.claude.available) {
      try {
        const messages: Anthropic.Beta.BetaMessageParam[] = [];
        for (const t of history.slice(-8)) if (t.text?.trim()) messages.push({ role: t.role, content: t.text.slice(0, 1500) });
        while (messages.length && messages[0].role !== "user") messages.shift();
        messages.push({ role: "user", content: `FACTS:\n${facts.text}\n\nQUESTION: ${question}` });
        const res = await this.claude.chat({ userId, feature: "listing.ask", system: SYSTEM, messages, maxTokens: 600, effort: "low" });
        const answer = textOf(res);
        if (answer) return { answer, source: "claude" as const };
      } catch (e) {
        if (e instanceof HttpException) throw e;
        this.log.warn(`falling back to rules: ${(e as Error).message}`);
      }
    }
    return { answer: this.rules(l, facts, question), source: "rules" as const };
  }

  /** Everything the answer may use, as plain text, plus the numbers the rules need. */
  private async factsFor(l: ListingRow) {
    const rent = l.purpose === "rent";
    const rate = l.priceInr && l.areaSqft ? Math.round(l.priceInr / l.areaSqft) : null;
    const [stats, similar] = await Promise.all([
      rent ? Promise.resolve(null) : this.search.localityStats(l.locality, l.city) as Promise<{ avgRatePerSqft?: number; listings?: number; medianPrice?: number } | null>,
      this.listingsSvc.search({ city: l.city, locality: l.locality, purpose: l.purpose as "sale" | "rent", bhk: l.bhk ?? undefined, limit: 8 }),
    ]);
    const others = (similar.items as unknown as ListingRow[]).filter((x) => x.id !== l.id && x.priceInr);
    const otherRates = others.filter((x) => x.areaSqft).map((x) => x.priceInr! / x.areaSqft!);
    const similarRate = otherRates.length ? Math.round(otherRates.reduce((a, b) => a + b, 0) / otherRates.length) : null;
    const loanEmi = !rent && l.priceInr ? emi(l.priceInr * 0.8) : null;
    const rooms = [...new Set((l.media ?? []).map((m) => m.label).filter(Boolean))];

    const lines = [
      `Title: ${l.title}`,
      `For: ${rent ? "rent" : "sale"}${l.status && l.status !== "active" ? ` (status: ${l.status})` : ""}`,
      `Type: ${l.kind}${l.bhk ? `, ${l.bhk} BHK` : ""}`,
      `Location: ${l.locality}, ${l.city}`,
      `Price: ${inr(l.priceInr)}${rent ? " per month" : ""}`,
      l.areaSqft ? `Area: ${l.areaSqft} sq ft` : "Area: not given",
      rate && !rent ? `Rate: ₹${rate.toLocaleString("en-IN")} per sq ft` : "",
      stats?.avgRatePerSqft ? `Locality average: ₹${Number(stats.avgRatePerSqft).toLocaleString("en-IN")} per sq ft across ${stats.listings} live sale listings, median price ${inr(Number(stats.medianPrice))}` : "Locality average: not enough data",
      similarRate ? `Similar ${l.bhk ?? ""} BHK listings here average ₹${similarRate.toLocaleString("en-IN")} per sq ft (${otherRates.length} listings)` : "",
      `Possession: ${l.possession ?? "not given"}`,
      `Furnishing: ${l.furnishing ?? "not given"}`,
      `Facing: ${l.facing ?? "not given"}`,
      `Amenities: ${(l.amenities ?? []).join(", ") || "not listed"}`,
      `Highlights: ${(l.usps ?? []).join("; ") || "none listed"}`,
      `Photos show: ${rooms.join(", ") || "not labelled"}`,
      `Verified by Topsqill.ai: ${l.verified ? "yes" : "no"}${l.reraNumber ? `; RERA ${l.reraNumber}` : ""}`,
      loanEmi ? `Home loan example: 80% loan (${inr(Math.round(l.priceInr! * 0.8))}) at 8.5% for 20 years ≈ ₹${loanEmi.toLocaleString("en-IN")} per month; down payment ${inr(Math.round(l.priceInr! * 0.2))} plus stamp duty and registration (typically 6–8% in most states)` : "",
      `Description: ${(l.description ?? "none").slice(0, 1500)}`,
    ].filter(Boolean);
    return { text: lines.join("\n"), rate, avg: stats?.avgRatePerSqft ? Number(stats.avgRatePerSqft) : null, similarRate, loanEmi };
  }

  /** Short answers to the common questions when AI is unavailable. */
  private rules(l: ListingRow, f: { rate: number | null; avg: number | null; similarRate: number | null; loanEmi: number | null }, q: string) {
    const t = q.toLowerCase();
    const ask = "For anything else, ask the seller with the Contact seller button.";
    if (/fair|overpriced|expensive|cheap|worth|good (price|deal)|negotia/.test(t)) {
      const ref = f.avg ?? f.similarRate;
      if (f.rate && ref) {
        const diff = Math.round(((f.rate - ref) / ref) * 100);
        const verdict = diff > 8 ? `about ${diff}% above` : diff < -8 ? `about ${-diff}% below` : "in line with";
        return `This home is priced at ₹${f.rate.toLocaleString("en-IN")} per sq ft, ${verdict} the ${l.locality} average of ₹${ref.toLocaleString("en-IN")}. ${diff > 8 ? "There may be room to negotiate." : diff < -8 ? "That looks like good value; check why with the seller." : "That looks like a fair asking price."}`;
      }
      return `There isn’t enough data in ${l.locality} yet to judge the price. ${ask}`;
    }
    if (/emi|loan|down ?payment|finance|monthly/.test(t) && f.loanEmi)
      return `With an 80% home loan at 8.5% for 20 years, the EMI would be about ₹${f.loanEmi.toLocaleString("en-IN")} a month. You’d pay about ${inr(Math.round(l.priceInr! * 0.2))} upfront, plus stamp duty and registration.`;
    if (/possession|ready|move in|handover|construction/.test(t)) return `Possession: ${l.possession ?? "not mentioned"}. ${ask}`;
    if (/size|area|sq|carpet|big/.test(t)) return l.areaSqft ? `It’s ${l.areaSqft.toLocaleString("en-IN")} sq ft${l.bhk ? `, ${l.bhk} BHK` : ""}. ${ask}` : `The area isn’t listed. ${ask}`;
    if (/amenit|pool|gym|club|park|security|lift/.test(t)) return (l.amenities ?? []).length ? `Amenities listed: ${(l.amenities ?? []).join(", ")}.` : `No amenities are listed. ${ask}`;
    if (/furnish/.test(t)) return `Furnishing: ${l.furnishing ?? "not mentioned"}.`;
    if (/facing|vastu|direction/.test(t)) return `Facing: ${l.facing ?? "not mentioned"}. ${ask}`;
    if (/verif|rera|legal|genuine/.test(t)) return `${l.verified ? "This listing is verified by Topsqill.ai." : "This listing isn’t verified yet."}${l.reraNumber ? ` RERA number: ${l.reraNumber}.` : ""} Always check the title papers before paying.`;
    return `I don’t have that detail for this listing. ${ask}`;
  }
}
