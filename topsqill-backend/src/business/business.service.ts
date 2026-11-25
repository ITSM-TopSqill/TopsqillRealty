import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { businesses } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { newId } from "../common/ids";
import { industryById, industriesBySector, recommendationsFor, INDUSTRIES } from "./industries";

type ProfileInput = {
  name: string; industryId: string; businessModel?: string; description?: string; products?: string;
  targetSegments?: string; geographicMarkets?: string; pricingNotes?: string; revenueModel?: string;
  acquisitionGoals?: string; salesCycle?: string; marketingBudgetInr?: number; existingChannels?: string[];
};

type DraftProfile = ProfileInput & { industryGuess: { id: string; label: string; confidence: "low" | "medium" | "high" } };

/**
 * Universal Multi-Industry Support, Section 3: the AI Business Discovery
 * Engine. A member describes their (non-real-estate) business in plain
 * language; Claude maps it to real industry fields the member reviews and
 * edits before anything is saved - it never silently writes a profile from
 * free text. Without an AI key, the member just fills the form directly.
 */
@Injectable()
export class BusinessService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  industries() { return industriesBySector(); }

  /** Turns a free-text business description into a reviewable draft profile. Never saved on its own. */
  async draftFromDescription(userId: string, description: string): Promise<DraftProfile> {
    const text = description.trim();
    if (!text) throw new BadRequestException("Describe the business in a sentence or two.");
    const fallback = (): DraftProfile => ({
      name: text.slice(0, 60), industryId: "other",
      description: text, industryGuess: { id: "other", label: "Other / not listed", confidence: "low" },
    });
    if (!(await this.claude.enabledFor("business-discovery"))) return fallback();

    const list = INDUSTRIES.map((i) => `${i.id}: ${i.label}`).join("\n");
    const { data } = await this.claude.json<Partial<DraftProfile> & { industryConfidence?: string }>(
      `A business owner wrote this about their own business:\n"""${text.slice(0, 1500)}"""\n\n` +
      `Pick the single closest industry id from this list (use "other" if none fit well):\n${list}\n\n` +
      `Reply with JSON only: {"name": "short business name", "industryId": "<id from the list>", "industryConfidence": "low"|"medium"|"high", "businessModel": "", "products": "", "targetSegments": "", "geographicMarkets": "", "acquisitionGoals": ""}. ` +
      `Every field except name and industryId/industryConfidence may be left as "" if the text doesn't say. Never invent facts the text doesn't contain.`,
      fallback, { userId, feature: "business-discovery", effort: "low", maxTokens: 500 },
    );
    const industry = industryById(data.industryId ?? "") ?? industryById("other")!;
    const confidence = data.industryConfidence === "high" || data.industryConfidence === "medium" ? data.industryConfidence : "low";
    return {
      name: (data.name || text.slice(0, 60)).slice(0, 160), industryId: industry.id,
      businessModel: data.businessModel || undefined, description: text,
      products: data.products || undefined, targetSegments: data.targetSegments || undefined,
      geographicMarkets: data.geographicMarkets || undefined, acquisitionGoals: data.acquisitionGoals || undefined,
      industryGuess: { id: industry.id, label: industry.label, confidence },
    };
  }

  async create(userId: string, input: ProfileInput) {
    if (!input.name?.trim()) throw new BadRequestException("A business name is needed.");
    if (!industryById(input.industryId)) throw new BadRequestException("Pick an industry from the list.");
    const [row] = await this.db.insert(businesses).values({
      id: newId(), ownerId: userId, name: input.name.trim().slice(0, 160), industryId: input.industryId,
      businessModel: input.businessModel?.slice(0, 120) || null, description: input.description?.slice(0, 2000) || null,
      products: input.products?.slice(0, 2000) || null, targetSegments: input.targetSegments?.slice(0, 1000) || null,
      geographicMarkets: input.geographicMarkets?.slice(0, 500) || null, pricingNotes: input.pricingNotes?.slice(0, 1000) || null,
      revenueModel: input.revenueModel?.slice(0, 120) || null, acquisitionGoals: input.acquisitionGoals?.slice(0, 1000) || null,
      salesCycle: input.salesCycle?.slice(0, 60) || null,
      marketingBudgetInr: input.marketingBudgetInr && input.marketingBudgetInr > 0 ? Math.round(input.marketingBudgetInr) : null,
      existingChannels: (input.existingChannels ?? []).slice(0, 10),
    }).returning();
    return { ...row, recommendations: recommendationsFor(row.industryId) };
  }

  async list(userId: string) {
    const rows = await this.read.select().from(businesses).where(eq(businesses.ownerId, userId)).orderBy(desc(businesses.createdAt));
    return { items: rows.map((r) => ({ ...r, recommendations: recommendationsFor(r.industryId) })) };
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(businesses).where(and(eq(businesses.id, id), eq(businesses.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That business profile could not be found.");
    return { ...row, recommendations: recommendationsFor(row.industryId) };
  }
}
