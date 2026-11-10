import { Injectable, Inject, Logger, HttpException } from "@nestjs/common";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, ilike, notInArray, or, sql } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { jobs, leads, listings, requirements, users } from "../db/schema";
import { ClaudeService, textOf } from "./claude.service";
import { WriterService } from "./writer.service";
import { ListingsService } from "../listings/listings.service";
import { SearchService } from "../search/search.service";
import { parseQuery, intentOf, inr, CITIES } from "./query";

export type Turn = { role: "user" | "assistant"; text: string };
type Card = Record<string, unknown> & { id: string };
export type AssistantReply = {
  reply: string;
  listings: Card[]; people: Card[]; localities: Card[]; jobs: Card[];
  source: "claude" | "rules";
};

const MAX_TOOL_ROUNDS = 5;

/** Kept identical between requests, so the API can cache it. */
const SYSTEM = `You are "Ask Topsqill.ai", the assistant inside Topsqill.ai, a professional network for Indian real estate (dealers, builders, buyers, sellers).

You help members search listings, find people, judge prices, check their leads and requirements, and write posts, WhatsApp messages and listing copy.

How to answer:
- Use the tools for any fact about listings, prices, people, jobs, leads or requirements. Never invent a listing, a price, a person or a number.
- The app shows the listings, people, localities and jobs your tools return as cards under your reply. So summarise in a sentence or two (count, price range, what stands out) instead of repeating every detail.
- If a search finds nothing, say so plainly and suggest one specific way to widen it (budget, locality, bedrooms).
- Money in Indian style: ₹2.4 Cr, ₹85 L, ₹45,000/month. Areas in sq ft.
- Writing requests (posts, WhatsApp, emails, descriptions, captions): write the text directly, ready to paste. No tools needed unless facts are required.
- Keep answers short: under 120 words unless asked to write something longer. Plain text with simple line breaks; no tables, no markdown headings.
- The member's own data (leads, requirements) is private to them. Only the tools reveal it, and only for this member.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_listings",
    description: "Search live property listings on Topsqill.ai. Use for any 'find / show me / looking for' property question. Prices are in rupees (1 Cr = 10000000, 1 L = 100000).",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City, e.g. Gurgaon, Noida, Mumbai, Bengaluru, Pune, Hyderabad, Delhi" },
        locality: { type: "string", description: "Locality or sector, e.g. Sector 65, Golf Course Road, Powai" },
        purpose: { type: "string", enum: ["sale", "rent"] },
        bhk: { type: "integer", description: "Bedrooms" },
        min_price: { type: "integer", description: "Minimum price in rupees (monthly rent for rentals)" },
        max_price: { type: "integer", description: "Maximum price in rupees (monthly rent for rentals)" },
        kind: { type: "string", enum: ["Apartment", "Builder floor", "Villa", "Plot", "Office", "Shop"] },
      },
    },
  },
  {
    name: "find_people",
    description: "Find members: dealers, builders, agents or anyone by name, company, city or speciality.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Name, company, speciality or locality" }, city: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "locality_insights",
    description: "Average sale price per sq ft, median price and number of live listings for a locality, from Topsqill.ai listings.",
    input_schema: {
      type: "object",
      properties: { locality: { type: "string" }, city: { type: "string" } },
      required: ["locality"],
    },
  },
  {
    name: "estimate_price",
    description: "Estimate a fair sale price range for a home from the locality's average rate per sq ft (falls back to the city average).",
    input_schema: {
      type: "object",
      properties: { locality: { type: "string" }, city: { type: "string" }, area_sqft: { type: "integer" } },
      required: ["area_sqft"],
    },
  },
  {
    name: "find_jobs",
    description: "Open real estate jobs on Topsqill.ai.",
    input_schema: { type: "object", properties: { query: { type: "string" }, city: { type: "string" } } },
  },
  {
    name: "my_leads",
    description: "The signed-in member's own lead pipeline: totals, this week's new leads, and the hottest open leads to follow up.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "my_requirements",
    description: "The signed-in member's own posted requirements and how many listings match each.",
    input_schema: { type: "object", properties: {} },
  },
];

/**
 * "Ask Topsqill.ai": one chat for search, matching, pricing and writing.
 *
 * Claude decides which tools to call; the tools read the database (only the
 * member's own leads and requirements, and public listings, people and jobs).
 * Without an AI key, or if a call fails, a rules-based reader answers instead,
 * so the assistant always returns real results.
 */
@Injectable()
export class AssistantService {
  private readonly log = new Logger("assistant");

  constructor(
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly writer: WriterService,
    private readonly listingsSvc: ListingsService,
    private readonly search: SearchService,
  ) {}

  async ask(userId: string, message: string, history: Turn[] = []): Promise<AssistantReply> {
    const out: AssistantReply = { reply: "", listings: [], people: [], localities: [], jobs: [], source: "claude" };
    if (this.claude.available) {
      try {
        await this.withClaude(userId, message, history, out);
        if (out.reply) return out;
      } catch (e) {
        if (e instanceof HttpException) throw e;                 // daily limit
        this.log.warn(`falling back to rules: ${(e as Error).message}`);
      }
    }
    const fresh: AssistantReply = { reply: "", listings: [], people: [], localities: [], jobs: [], source: "rules" };
    await this.withRules(userId, message, fresh);
    return fresh;
  }

  /* ------------------------------ with Claude ------------------------------ */

  private async withClaude(userId: string, message: string, history: Turn[], out: AssistantReply) {
    const [me] = await this.read.select({ name: users.name, type: users.type, city: users.city })
      .from(users).where(eq(users.id, userId)).limit(1);
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const t of tidy(history)) messages.push({ role: t.role, content: t.text });
    messages.push({
      role: "user",
      content: `${message}\n\n(Member: ${me?.name ?? "member"}, ${me?.type ?? "member"}${me?.city ? `, based in ${me.city}` : ""}. Today is ${new Date().toISOString().slice(0, 10)}.)`,
    });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.claude.chat({
        userId, feature: "assistant", system: SYSTEM, tools: TOOLS, messages, maxTokens: 1500, effort: "medium",
      });
      // The whole content goes back, thinking blocks included, as the API expects.
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") { out.reply = textOf(res); return; }

      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      // Every result goes back in one message, so parallel calls keep working.
      const results = await Promise.all(calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const content = await this.runTool(userId, c.name, (c.input ?? {}) as Record<string, unknown>, out);
          return { type: "tool_result", tool_use_id: c.id, content };
        } catch (e) {
          return { type: "tool_result", tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true };
        }
      }));
      messages.push({ role: "user", content: results });
    }
    out.reply = "I looked through quite a lot there. Here’s what I found so far.";
  }

  /** Runs one tool, adds anything it found to the cards, and returns a short text summary for Claude. */
  private async runTool(userId: string, name: string, input: Record<string, unknown>, out: AssistantReply): Promise<string> {
    const str = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined);
    const num = (k: string) => (typeof input[k] === "number" && isFinite(input[k] as number) ? Math.round(input[k] as number) : undefined);

    switch (name) {
      case "search_listings": {
        const found = await this.findListings({
          city: str("city"), locality: str("locality"), purpose: str("purpose") as "sale" | "rent" | undefined,
          bhk: num("bhk"), minPrice: num("min_price"), maxPrice: num("max_price"), kind: str("kind"),
        });
        addCards(out.listings, found.items);
        if (!found.items.length) return "No live listings match.";
        return `${found.note}${found.items.length} listings:\n` + found.items.map((l) =>
          `- ${l.title} | ${inr(l.priceInr as number)}${l.purpose === "rent" ? "/month" : ""} | ${l.bhk ?? "-"} BHK | ${l.areaSqft ?? "?"} sq ft | ${l.locality}, ${l.city}${l.possession ? ` | ${l.possession}` : ""}`).join("\n");
      }
      case "find_people": {
        const q = [str("query"), str("city")].filter(Boolean).join(" ");
        const res = await this.search.suggest(q, 6, "people");
        addCards(out.people, res.people as Card[]);
        if (!res.people.length) return "No members found.";
        return res.people.map((p: Record<string, unknown>) => `- ${p.name} (${p.type}) ${p.headline ?? ""} ${p.city ?? ""}`).join("\n");
      }
      case "locality_insights": {
        const stats = await this.localityStats(str("locality")!, str("city"));
        if (!stats) return "No sale listings in that locality yet, so there is no average.";
        addCards(out.localities, [{ id: `${stats.locality}|${stats.city}`, ...stats }]);
        return `${stats.locality}, ${stats.city}: ${stats.listings} live sale listings, average ₹${Number(stats.avgRatePerSqft).toLocaleString("en-IN")}/sq ft, median price ${inr(Number(stats.medianPrice))}.`;
      }
      case "estimate_price": {
        const area = num("area_sqft");
        if (!area) return "Area is needed.";
        const est = await this.estimate(area, str("locality"), str("city"));
        if (!est) return "There isn’t enough data in that area to estimate.";
        return `Estimate for ${area} sq ft (${est.basis}): ${inr(est.low)} to ${inr(est.high)}, at about ₹${est.rate.toLocaleString("en-IN")}/sq ft.`;
      }
      case "find_jobs": {
        const rows = await this.findJobs(str("query"), str("city"));
        addCards(out.jobs, rows);
        if (!rows.length) return "No open jobs match.";
        return rows.map((j) => `- ${j.title} at ${j.company}, ${j.city}`).join("\n");
      }
      case "my_leads": return this.leadsSummary(userId);
      case "my_requirements": return this.requirementsSummary(userId);
      default: return "Unknown tool.";
    }
  }

  /* ------------------------------- the tools ------------------------------- */

  /** Listing search that forgives spelling of the place, and widens once if nothing matches. */
  private async findListings(q: { city?: string; locality?: string; purpose?: "sale" | "rent"; bhk?: number; minPrice?: number; maxPrice?: number; kind?: string }) {
    const city = q.city ? canonicalCity(q.city) : undefined;
    const locality = q.locality ? await this.canonicalLocality(q.locality, city) : undefined;
    const base = { purpose: q.purpose ?? "sale" as const, bhk: q.bhk, minPrice: q.minPrice, maxPrice: q.maxPrice, kind: q.kind, limit: 6 };
    let res = await this.listingsSvc.search({ ...base, city: locality?.city ?? city, locality: locality?.name });
    let note = "";
    if (!res.items.length && locality) {
      res = await this.listingsSvc.search({ ...base, city: locality.city ?? city });
      if (res.items.length) note = `Nothing in ${locality.name} itself; these are elsewhere in ${locality.city ?? city}. `;
    }
    return { items: res.items as unknown as Card[], note };
  }

  /** "sector 65" → "Sector 65" (as listings store it), with its city. */
  private async canonicalLocality(name: string, city?: string) {
    const term = name.trim();
    const [exact] = await this.read.select({ name: listings.locality, city: listings.city }).from(listings)
      .where(and(ilike(listings.locality, term), city ? eq(listings.city, city) : undefined)).limit(1);
    if (exact) return exact;
    const [near] = await this.read.select({ name: listings.locality, city: listings.city }).from(listings)
      .where(and(ilike(listings.locality, `%${term.replace(/[%_]/g, "")}%`), city ? eq(listings.city, city) : undefined)).limit(1);
    return near ?? null;
  }

  private async localityStats(locality: string, city?: string) {
    const place = await this.canonicalLocality(locality, city ? canonicalCity(city) : undefined);
    if (!place) return null;
    const stats = await this.search.localityStats(place.name, place.city);
    return stats as { locality: string; city: string; listings: number; avgRatePerSqft: number; medianPrice: number } | null;
  }

  private async estimate(area: number, locality?: string, city?: string) {
    if (locality) {
      const s = await this.localityStats(locality, city);
      if (s?.avgRatePerSqft) return band(area, Number(s.avgRatePerSqft), `${s.locality} average`);
    }
    const c = city ? canonicalCity(city) : undefined;
    if (!c) return null;
    const [row] = await this.read.select({ rate: sql<number>`round(avg(${listings.priceInr} / nullif(${listings.areaSqft}, 0)))::int` })
      .from(listings).where(and(eq(listings.city, c), eq(listings.status, "active"), eq(listings.purpose, "sale")));
    return row?.rate ? band(area, Number(row.rate), `${c} average`) : null;
  }

  private async findJobs(query?: string, city?: string) {
    const where = [eq(jobs.status, "open")];
    if (city) where.push(eq(jobs.city, canonicalCity(city)));
    if (query) {
      const like = `%${query.replace(/[%_]/g, "")}%`;
      where.push(or(ilike(jobs.title, like), ilike(jobs.company, like), ilike(jobs.category, like))!);
    }
    const rows = await this.read.select({ id: jobs.id, title: jobs.title, company: jobs.company, city: jobs.city, locality: jobs.locality, employment: jobs.employment })
      .from(jobs).where(and(...where)).orderBy(desc(jobs.createdAt)).limit(6);
    return rows as Card[];
  }

  private async leadsSummary(userId: string) {
    const stats = await this.read.execute(sql`
      select count(*)::int as total,
             count(*) filter (where created_at > now() - interval '7 days')::int as "thisWeek",
             count(*) filter (where stage = 'new')::int as "untouched",
             count(*) filter (where stage = 'booked')::int as booked
      from leads where owner_id = ${userId} or assignee_id = ${userId}`);
    const s = (Array.isArray(stats) ? stats[0] : (stats as { rows: unknown[] }).rows[0]) as Record<string, number>;
    if (!s?.total) return "This member has no leads yet.";
    const hot = await this.read.select({ name: leads.name, stage: leads.stage, score: leads.score, locality: leads.locality, budgetMax: leads.budgetMax, lastActivityAt: leads.lastActivityAt })
      .from(leads).where(and(or(eq(leads.ownerId, userId), eq(leads.assigneeId, userId)), notInArray(leads.stage, ["booked", "lost"])))
      .orderBy(desc(leads.score)).limit(5);
    return `Leads: ${s.total} total, ${s.thisWeek} new this week, ${s.untouched} not contacted yet, ${s.booked} booked.\nHottest open leads:\n` +
      hot.map((l) => `- ${l.name}: ${l.stage}, score ${l.score}${l.locality ? `, wants ${l.locality}` : ""}${l.budgetMax ? `, budget ${inr(l.budgetMax)}` : ""}${l.lastActivityAt ? `, last touched ${l.lastActivityAt.toISOString().slice(0, 10)}` : ", never contacted"}`).join("\n") +
      "\n(The member can open these on the Leads page.)";
  }

  private async requirementsSummary(userId: string) {
    const rows = await this.read.select().from(requirements).where(eq(requirements.userId, userId)).orderBy(desc(requirements.createdAt)).limit(10);
    if (!rows.length) return "This member hasn’t posted a requirement.";
    return rows.map((r) => `- ${r.bhk ? `${r.bhk} BHK ` : ""}${r.kind} to ${r.purpose === "rent" ? "rent" : "buy"} in ${r.localities.join(", ")}, ${r.city}; budget up to ${inr(r.maxPrice)}; ${r.status}; ${r.matchCount} matching listings`).join("\n");
  }

  /* ---------------------------- without Claude ---------------------------- */

  private async withRules(userId: string, message: string, out: AssistantReply) {
    const intent = intentOf(message);
    const p = parseQuery(message);
    const loc = p.rest ? (await this.search.suggest(p.rest, 1, "localities")).localities[0] as { locality?: string; city?: string } | undefined : undefined;

    if (intent === "write") {
      const res = await this.writer.post(userId, message.replace(/^\s*(write|draft|compose)\s+(a\s+)?(post\s+)?(about\s+)?/i, ""), "write");
      out.reply = res.text;
      return;
    }
    if (intent === "leads") { out.reply = (await this.leadsSummary(userId)).replace(/^Leads: /, "Your leads: "); return; }
    if (intent === "requirements") { out.reply = await this.requirementsSummary(userId); return; }
    if (intent === "jobs") {
      out.jobs = await this.findJobs(p.rest.replace(/\b(jobs?|hiring|vacanc\w*|openings?)\b/gi, "").trim() || undefined, p.city);
      out.reply = out.jobs.length ? (out.jobs.length === 1 ? "Here is 1 open role." : `Here are ${out.jobs.length} open roles.`) : "No open jobs match that yet.";
      return;
    }
    if (intent === "people") {
      const res = await this.search.suggest([p.rest.replace(/\b(top|best|good|dealers?|agents?|brokers?|who)\b/gi, "").trim(), p.city].filter(Boolean).join(" ") || p.city || p.rest, 6, "people");
      out.people = res.people as Card[];
      out.reply = out.people.length ? `I found ${out.people.length === 1 ? "1 member" : `${out.people.length} members`} who fit.` : "I couldn’t find members matching that. Try a name, company or locality.";
      return;
    }
    if (intent === "price") {
      const where = loc?.locality ?? p.rest;
      if (p.areaSqft && (where || p.city)) {
        const est = await this.estimate(p.areaSqft, where || undefined, loc?.city ?? p.city);
        if (est) { out.reply = `For ${p.areaSqft.toLocaleString("en-IN")} sq ft, a fair price is about ${inr(est.low)} to ${inr(est.high)} (${est.basis}, ₹${est.rate.toLocaleString("en-IN")}/sq ft).`; return; }
      }
      const stats = where ? await this.localityStats(where, loc?.city ?? p.city) : null;
      if (stats) {
        out.localities = [{ id: `${stats.locality}|${stats.city}`, ...stats }];
        out.reply = `${stats.locality}, ${stats.city} averages ₹${Number(stats.avgRatePerSqft).toLocaleString("en-IN")} per sq ft across ${stats.listings} live listings (median ${inr(Number(stats.medianPrice))}).`;
        return;
      }
      out.reply = "I don’t have enough listings there to judge the price. Try a nearby locality.";
      return;
    }
    const found = await this.findListings({ city: loc?.city ?? p.city, locality: loc?.locality, purpose: p.purpose, bhk: p.bhk, minPrice: p.minPrice, maxPrice: p.maxPrice, kind: p.kind });
    out.listings = found.items;
    out.reply = found.items.length
      ? `${found.note}Here ${found.items.length === 1 ? "is 1 listing" : `are ${found.items.length} listings`}${p.bhk ? ` with ${p.bhk} BHK` : ""}${loc?.locality && !found.note ? ` in ${loc.locality}` : (loc?.city ?? p.city) ? ` in ${loc?.city ?? p.city}` : ""}${p.maxPrice ? ` under ${inr(p.maxPrice)}` : ""}.`
      : "Nothing matches that yet. Try a higher budget, a nearby locality, or fewer bedrooms.";
  }
}

/* -------------------------------- helpers -------------------------------- */

function tidy(history: Turn[]) {
  const recent = history.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-12).map((t) => ({ role: t.role, text: t.text.slice(0, 2000) }));
  while (recent.length && recent[0].role !== "user") recent.shift();   // a conversation starts with the member
  return recent;
}

function canonicalCity(c: string) {
  for (const [re, name] of CITIES) if (re.test(c)) return name;
  return c.trim().replace(/\b\w/g, (x) => x.toUpperCase());
}

function band(area: number, rate: number, basis: string) {
  const mid = area * rate;
  return { low: Math.round(mid * 0.92 / 1e5) * 1e5, high: Math.round(mid * 1.08 / 1e5) * 1e5, rate, basis };
}

function addCards(into: Card[], items: Card[]) {
  const seen = new Set(into.map((c) => c.id));
  for (const i of items) if (!seen.has(i.id) && into.length < 12) { into.push(i); seen.add(i.id); }
}
