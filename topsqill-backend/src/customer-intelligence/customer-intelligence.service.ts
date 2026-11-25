import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, or } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { customerSegments, leads } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { newId } from "../common/ids";
import {
  DIFFERENTIATORS, validateSegmentDefinition, filterLeads, differentiatorById,
  type LeadFacts, type SegmentDefinition, type Condition, InvalidConditionError,
} from "./differentiators";

/** Leads loaded per preview/segment run. Real-estate CRMs this size run in the thousands, not millions - see the module doc for why this is evaluated in application code rather than pushed into SQL. */
const LEAD_FACTS_LIMIT = 5000;

type DraftSegment = { conditions: Condition[]; explanation: string; unavailableRequest: string | null };

/**
 * Universal Customer Differentiator Engine + Audience Builder (Universal
 * Topsqill spec, Part 4-5), Workstream 2. Builds and saves CRM segments
 * over Topsqill's own real lead data - never a provider-targeting spec
 * (no Custom Audience push exists), never a signal Topsqill doesn't
 * actually have (no wealth/health/financial inference).
 */
@Injectable()
export class CustomerIntelligenceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
  ) {}

  differentiators() { return DIFFERENTIATORS; }

  /** Turns a free-text customer description into a reviewable set of conditions. Never saved on its own, and never invents a signal Topsqill doesn't have. */
  async draftFromDescription(userId: string, description: string): Promise<DraftSegment> {
    const text = description.trim();
    if (!text) throw new BadRequestException("Describe the customer you want in a sentence or two.");
    const fallback = (): DraftSegment => ({
      conditions: [], explanation: "AI is off right now, so this couldn't be read automatically. Build the segment directly from the differentiator catalog below instead.",
      unavailableRequest: null,
    });
    if (!(await this.claude.enabledFor("customer-intelligence"))) return fallback();

    const catalog = DIFFERENTIATORS.map((d) => `${d.id} (${d.valueType}${d.enumValues ? `: ${d.enumValues.join("|")}` : ""}) - ${d.name}: ${d.description}`).join("\n");
    const { data } = await this.claude.json<{ conditions?: { differentiatorId: string; operator: string; value: unknown }[]; explanation?: string; unavailableRequest?: string | null }>(
      `A business wants to describe the customers they're looking for: """${text.slice(0, 800)}"""\n\n` +
      `Topsqill can ONLY segment real leads by these real fields (never invent one that isn't listed):\n${catalog}\n\n` +
      `If the request implies something Topsqill has no data for (financial status, net worth, bank/card ownership, health, employer data, or any other attribute not in the list above), do NOT invent a matching condition for it. ` +
      `Instead return an empty conditions array and explain in "unavailableRequest" what couldn't be matched, suggesting the closest real field instead (e.g. declared budget_max instead of guessing wealth).\n\n` +
      `Reply with JSON only: {"conditions": [{"differentiatorId": "...", "operator": "eq"|"neq"|"gte"|"lte"|"in"|"not_in"|"contains", "value": ...}], "explanation": "one sentence on what this segment captures", "unavailableRequest": null or "what couldn't be matched and why"}.`,
      fallback, { userId, feature: "customer-intelligence", effort: "low", maxTokens: 700 },
    );
    const conditions: Condition[] = [];
    for (const c of data.conditions ?? []) {
      try {
        const cond: Condition = { kind: "condition", differentiatorId: c.differentiatorId, operator: c.operator as Condition["operator"], value: c.value };
        validateSegmentDefinition({ include: { kind: "group", match: "all", conditions: [cond] } });
        conditions.push(cond);
      } catch { /* the model named a field/operator that doesn't exist - drop it rather than save garbage */ }
    }
    return { conditions, explanation: data.explanation ?? "", unavailableRequest: data.unavailableRequest ?? null };
  }

  async create(userId: string, name: string, definition: SegmentDefinition, source: "manual" | "ai" = "manual") {
    if (!name?.trim()) throw new BadRequestException("A segment name is needed.");
    try { validateSegmentDefinition(definition); }
    catch (e) { if (e instanceof InvalidConditionError) throw new BadRequestException(e.message); throw e; }

    const [row] = await this.db.insert(customerSegments).values({
      id: newId(), ownerId: userId, name: name.trim().slice(0, 160), definition: definition as never, source,
    }).returning();
    return { ...row, preview: await this.preview(userId, definition) };
  }

  async list(userId: string) {
    const rows = await this.read.select().from(customerSegments).where(eq(customerSegments.ownerId, userId)).orderBy(desc(customerSegments.createdAt));
    return { items: rows };
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(customerSegments).where(and(eq(customerSegments.id, id), eq(customerSegments.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That segment could not be found.");
    return { ...row, preview: await this.preview(userId, row.definition as unknown as SegmentDefinition) };
  }

  async remove(userId: string, id: string) {
    const [row] = await this.db.select().from(customerSegments).where(and(eq(customerSegments.id, id), eq(customerSegments.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That segment could not be found.");
    await this.db.delete(customerSegments).where(eq(customerSegments.id, id));
    return { ok: true };
  }

  /** Evaluated in application code against this owner's real leads, matched live every call - never cached, so it can't go stale. */
  async preview(userId: string, definition: SegmentDefinition) {
    const facts = await this.leadFacts(userId);
    const matched = filterLeads(facts, definition);
    return {
      totalLeadsConsidered: facts.length,
      matchedCount: matched.length,
      sample: matched.slice(0, 10).map((l) => ({ id: l.id, name: l.name, stage: l.stage, score: l.score, qualified: l.qualified })),
      truncated: facts.length >= LEAD_FACTS_LIMIT,
    };
  }

  private async leadFacts(userId: string): Promise<LeadFacts[]> {
    const rows = await this.read.select({
      id: leads.id, name: leads.name, stage: leads.stage, qualified: leads.qualified, score: leads.score, source: leads.source,
      campaignId: leads.campaignId, budgetMax: leads.budgetMax, locality: leads.locality, city: leads.city,
      lastActivityAt: leads.lastActivityAt, createdAt: leads.createdAt,
    }).from(leads).where(or(eq(leads.ownerId, userId), eq(leads.assigneeId, userId))).limit(LEAD_FACTS_LIMIT);

    const now = Date.now();
    const days = (t: Date | null) => t ? Math.floor((now - t.getTime()) / 86_400_000) : null;
    return rows.map((r) => ({
      id: r.id, name: r.name, stage: r.stage, qualified: r.qualified, score: r.score, source: r.source,
      campaignSourced: !!r.campaignId, budgetMax: r.budgetMax != null ? Number(r.budgetMax) : null,
      locality: r.locality, city: r.city,
      daysSinceActivity: days(r.lastActivityAt) ?? days(r.createdAt) ?? 0,
      daysSinceCreated: days(r.createdAt) ?? 0,
    }));
  }
}

export { differentiatorById };
