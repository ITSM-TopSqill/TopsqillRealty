import { Injectable, Inject, BadRequestException, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { competitors, businesses } from "../db/schema";
import { newId } from "../common/ids";
import { ClaudeService } from "../ai/claude.service";

export const CATEGORIES = [
  "direct", "indirect", "substitute", "emerging", "premium", "price_focused", "market_leader", "regional",
] as const;
export type Category = (typeof CATEGORIES)[number];

const MAX_PER_OWNER = 60;
const MAX_SUGGESTIONS = 8;

type ManualInput = { name: string; website?: string; category?: Category; notes?: string };

/**
 * Competitor Discovery (Competitive Growth Intelligence spec, Module 1): the
 * member's own list of tracked competitors, entered by hand or suggested by
 * AI from a business profile. AI suggestions are written as `status:
 * "suggested"` rows with a required `rationale` - never auto-accepted, and
 * never a bare name with no evidence for why it was proposed (the spec's
 * "never invent a competitor or claim a relationship without evidence").
 */
@Injectable()
export class CompetitorDiscoveryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  private async countForOwner(userId: string) {
    const rows = await this.read.select({ id: competitors.id }).from(competitors).where(eq(competitors.ownerId, userId));
    return rows.length;
  }

  async add(userId: string, input: ManualInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("A competitor name is needed.");
    if (input.category && !CATEGORIES.includes(input.category)) throw new BadRequestException("Not a recognised competitor category.");
    if ((await this.countForOwner(userId)) >= MAX_PER_OWNER) throw new BadRequestException(`You can track up to ${MAX_PER_OWNER} competitors - remove one before adding another.`);
    const [row] = await this.db.insert(competitors).values({
      id: newId(), ownerId: userId, name: name.slice(0, 160),
      website: input.website?.trim().slice(0, 300) || null,
      category: input.category ?? "direct",
      status: "accepted", source: "manual",
      notes: input.notes?.trim().slice(0, 2000) || null,
    }).returning();
    return row;
  }

  async list(userId: string) {
    const rows = await this.read.select().from(competitors).where(eq(competitors.ownerId, userId)).orderBy(desc(competitors.createdAt));
    return { items: rows };
  }

  async setStatus(userId: string, id: string, status: "accepted" | "rejected") {
    const [row] = await this.db.select().from(competitors).where(and(eq(competitors.id, id), eq(competitors.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That competitor could not be found.");
    const [updated] = await this.db.update(competitors).set({ status, updatedAt: new Date() })
      .where(eq(competitors.id, id)).returning();
    return updated;
  }

  async remove(userId: string, id: string) {
    const [row] = await this.db.select().from(competitors).where(and(eq(competitors.id, id), eq(competitors.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That competitor could not be found.");
    await this.db.delete(competitors).where(eq(competitors.id, id));
    return { ok: true };
  }

  /**
   * Asks Claude for plausible competitors given the member's own business
   * profile (products, segments, geography). Every suggestion must come
   * with a one-line reason grounded in that profile; a suggestion with no
   * usable reason is dropped rather than saved with a placeholder. Nothing
   * is ever marked "accepted" here - the member reviews each one.
   */
  async suggest(userId: string, businessId?: string) {
    if (!(await this.claude.enabledFor("competitor-discovery"))) {
      throw new BadRequestException("AI suggestions are off right now - add competitors directly instead.");
    }
    let profile = "";
    if (businessId) {
      const [biz] = await this.read.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.ownerId, userId))).limit(1);
      if (biz) {
        profile = [
          biz.name && `Business: ${biz.name}`,
          biz.industryId && `Industry: ${biz.industryId}`,
          biz.products && `Products/services: ${biz.products}`,
          biz.targetSegments && `Target customers: ${biz.targetSegments}`,
          biz.geographicMarkets && `Markets: ${biz.geographicMarkets}`,
        ].filter(Boolean).join("\n");
      }
    }
    if (!profile.trim()) throw new BadRequestException("Add a business profile first (or pick one), so suggestions are grounded in something real.");

    const existing = (await this.list(userId)).items.map((c) => c.name.toLowerCase());
    const fallback = () => ({ suggestions: [] as { name: string; website: string | null; category: Category; rationale: string }[] });
    const { data, source } = await this.claude.json<ReturnType<typeof fallback>>(
      `A business owner's profile:\n${profile}\n\n` +
      `Already tracked (don't repeat these): ${existing.join(", ") || "none"}\n\n` +
      `Suggest up to ${MAX_SUGGESTIONS} real, plausible competitor businesses for this profile - companies you have genuine reason to believe compete for similar customers, based only on the profile above. Never invent a company name with no real-world basis; if you aren't confident a business like this plausibly exists, leave it out rather than guessing a specific brand name. ` +
      `For each: a category from exactly these values - direct, indirect, substitute, emerging, premium, price_focused, market_leader, regional - and a one-sentence rationale tying it back to the profile. ` +
      `Reply with JSON only: {"suggestions": [{"name": "", "website": null, "category": "direct", "rationale": ""}]}. Website may be null if you don't know it with confidence - never guess a URL.`,
      fallback, { userId, feature: "competitor-discovery", effort: "medium", maxTokens: 900 },
    );
    if (source !== "claude") throw new BadRequestException("Couldn't generate suggestions right now - please try again shortly.");

    const clean = (data.suggestions ?? [])
      .filter((s) => s?.name?.trim() && s?.rationale?.trim() && CATEGORIES.includes(s.category))
      .filter((s) => !existing.includes(s.name.trim().toLowerCase()))
      .slice(0, MAX_SUGGESTIONS);
    if (!clean.length) return { items: [] };

    const roomLeft = MAX_PER_OWNER - (await this.countForOwner(userId));
    const toInsert = clean.slice(0, Math.max(0, roomLeft)).map((s) => ({
      id: newId(), ownerId: userId, name: s.name.trim().slice(0, 160),
      website: s.website?.trim().slice(0, 300) || null,
      category: s.category, status: "suggested" as const, source: "ai" as const,
      rationale: s.rationale.trim().slice(0, 500),
    }));
    if (!toInsert.length) return { items: [] };
    const rows = await this.db.insert(competitors).values(toInsert).returning();
    return { items: rows };
  }
}
