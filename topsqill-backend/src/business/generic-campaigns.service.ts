import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { businesses, genericCampaigns } from "../db/schema";
import { newId } from "../common/ids";
import { industryById } from "./industries";

type CreateInput = { businessId: string; name: string; objective: string; conversionEvent: string; budgetInr: number; days?: number; notes?: string };

/**
 * Universal Campaign Objectives & Conversion Engine (Sections 5-6) for
 * non-real-estate businesses: a draft marketing plan - objective, conversion
 * event, budget - built from the business's own industry recommendations.
 *
 * KNOWN LIMITATION: this only ever creates a draft. It does not launch to
 * Meta/Google/any channel the way src/campaigns does for real estate - that
 * needs its own per-platform objective mapping, creative generation and
 * compliance checks (Sections 7, 9) which are future work, not built here.
 */
@Injectable()
export class GenericCampaignsService {
  constructor(@Inject(DB) private readonly db: Database, @Inject(DB_READ) private readonly read: Database) {}

  private async ownedBusiness(userId: string, businessId: string) {
    const [b] = await this.read.select().from(businesses).where(and(eq(businesses.id, businessId), eq(businesses.ownerId, userId))).limit(1);
    if (!b) throw new NotFoundException("That business profile could not be found.");
    return b;
  }

  async create(userId: string, input: CreateInput) {
    const business = await this.ownedBusiness(userId, input.businessId);
    if (!input.name?.trim()) throw new BadRequestException("A campaign name is needed.");
    if (!input.objective?.trim() || !input.conversionEvent?.trim()) throw new BadRequestException("An objective and a conversion event are needed.");
    if (!(input.budgetInr > 0)) throw new BadRequestException("Budget must be more than zero.");
    const ind = industryById(business.industryId);
    if (ind && !ind.objectives.includes(input.objective)) {
      throw new BadRequestException(`"${input.objective}" isn't one of the objectives recommended for ${ind.label}. Pick one of: ${ind.objectives.join(", ")}.`);
    }
    const [row] = await this.db.insert(genericCampaigns).values({
      id: newId(), businessId: business.id, ownerId: userId, name: input.name.trim().slice(0, 160),
      objective: input.objective.slice(0, 60), conversionEvent: input.conversionEvent.slice(0, 80),
      budgetInr: Math.round(input.budgetInr), days: input.days && input.days >= 3 ? Math.min(Math.round(input.days), 90) : 15,
      notes: input.notes?.slice(0, 400) || null,
    }).returning();
    return row;
  }

  async list(userId: string, businessId?: string) {
    const where = businessId ? and(eq(genericCampaigns.ownerId, userId), eq(genericCampaigns.businessId, businessId)) : eq(genericCampaigns.ownerId, userId);
    const rows = await this.read.select().from(genericCampaigns).where(where).orderBy(desc(genericCampaigns.createdAt));
    return { items: rows };
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(genericCampaigns).where(and(eq(genericCampaigns.id, id), eq(genericCampaigns.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That campaign could not be found.");
    return row;
  }
}
