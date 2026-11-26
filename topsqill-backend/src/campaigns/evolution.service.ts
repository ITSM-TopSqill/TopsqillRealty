import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { campaignEvolutions, campaignRecommendations } from "../db/schema";
import { ClaudeService } from "../ai/claude.service";
import { CampaignsService } from "./campaigns.service";
import { newId } from "../common/ids";
import { buildFallbackVersion, validateVersions, compareOutcome, runExperiment, type CampaignSnapshot, type EvolutionVersion, type Confidence } from "./evolution";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const SYSTEM = `You are an expert performance-marketing strategist improving ONE existing Topsqill real-estate ad campaign.

Use ONLY the real campaign data given to you. Topsqill has no competitor-ad research, industry-benchmark data or external market data connected in this build - never reference a competitor, a benchmark, or anything not given to you below.

Propose up to 3 distinct redesign versions. Each version is a different overall direction (e.g. one focused on creative/messaging, one on audience/geography, one on budget pacing) - not three near-identical tweaks.

Every change must set one of these exact fields: "Headline", "Primary text", "Call to action", "Total budget", "Excluded areas", "Extra targeted areas", "Campaign goal". Never invent a field.

For every change give: the real current value, a specific proposed value, a reason tied to the real data given, the exact evidence (cite the real number), the expected impact, a confidence level (use "low" whenever the underlying data is thin - under ~10 leads or under 3 qualified leads), and a risk if the change doesn't work out.

If performance data is too thin to support ANY confident change (e.g. 0 leads so far, or the campaign hasn't launched), say so plainly in that version's summary instead of inventing a data-driven reason - an empty changes array is a valid, honest answer.`;

/**
 * AI Campaign Evolution, first-party slice: analyses one existing
 * campaign's own real config/performance and proposes concrete redesign
 * changes, reusing CampaignsService.get()/insights() rather than
 * recomputing anything. Never writes to the live campaign - approving
 * changes creates a new draft via the existing create()/updateCreatives()
 * pipeline, so the normal review/launch approval still applies.
 */
@Injectable()
export class CampaignEvolutionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly campaigns: CampaignsService,
  ) {}

  async analyse(userId: string, campaignId: string) {
    const c = await this.campaigns.get(userId, campaignId);
    const { metrics } = await this.campaigns.insights(userId, campaignId).catch(() => ({ metrics: null }));
    const creatives = (c.creatives ?? {}) as Record<string, unknown>;
    const snapshot: CampaignSnapshot = {
      status: c.status, goal: c.goal, budgetInr: Number(c.budgetInr), days: Number(c.days),
      spendInr: Number(c.spendInr), leadsCount: Number(c.leadsCount), qualifiedCount: Number(c.qualifiedCount),
      headlines: (creatives.headlines as string[] | undefined) ?? [],
      primaryTexts: (creatives.primaryTexts as string[] | undefined) ?? [],
      cta: (creatives.cta as string | undefined) ?? null,
      extraPlaces: (c.extraPlaces ?? []).map((p) => p.label),
      excludePlaces: (c.excludePlaces ?? []).map((p) => p.label),
      platforms: metrics?.platforms.map((p) => ({ platform: p.platform, spendPaise: p.spendPaise, qualified: p.qualified, leads: p.leads })) ?? [],
      localities: metrics?.localities ?? [],
    };

    const pendingRecsRaw = await this.read.select().from(campaignRecommendations)
      .where(and(eq(campaignRecommendations.campaignId, campaignId), eq(campaignRecommendations.status, "pending")));
    const pendingRecs = pendingRecsRaw.map((r) => ({ ...r, confidence: r.confidence as Confidence }));

    let versions: EvolutionVersion[];
    let source: "claude" | "rules" = "rules";
    if (await this.claude.enabledFor("campaign-evolution")) {
      const fallback = () => [buildFallbackVersion(snapshot, pendingRecs)];
      const { data, source: s } = await this.claude.json<{ versions?: EvolutionVersion[] }>(
        `Campaign data:\n${JSON.stringify(snapshot, null, 2)}\n\nAlready-flagged AI recommendations for this campaign (Phase 5, do not repeat them verbatim - build on them or propose something new):\n${JSON.stringify(pendingRecs.map((r) => ({ category: r.category, title: r.title, why: r.why, confidence: r.confidence })), null, 2)}\n\n` +
        `Reply with JSON only: {"versions": [{"id": "v1", "label": "short label", "summary": "1-2 sentences", "changes": [{"id": "v1-c1", "dimension": "audience"|"creative"|"messaging"|"budget"|"geographic", "field": "<one of the exact allowed fields>", "currentValue": "...", "proposedValue": "...", "reason": "...", "evidence": "...", "expectedImpact": "...", "confidence": "low"|"medium"|"high", "risk": "..."}]}]}. Up to 3 versions.`,
        () => ({ versions: fallback() }),
        { userId, feature: "campaign-evolution", effort: "medium", maxTokens: 2500 },
      );
      versions = data.versions?.length ? data.versions : fallback();
      source = s === "claude" ? "claude" : "rules";
      try { validateVersions(versions); } catch { versions = fallback(); source = "rules"; }
    } else {
      versions = [buildFallbackVersion(snapshot, pendingRecs)];
    }

    const [row] = await this.db.insert(campaignEvolutions).values({
      id: newId(), campaignId, ownerId: userId, source, versions: versions as never,
    }).returning();
    return row;
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(campaignEvolutions).where(and(eq(campaignEvolutions.id, id), eq(campaignEvolutions.ownerId, userId))).limit(1);
    if (!row) throw new NotFoundException("That analysis could not be found.");
    return row;
  }

  async list(userId: string, campaignId: string) {
    const rows = await this.read.select().from(campaignEvolutions)
      .where(and(eq(campaignEvolutions.campaignId, campaignId), eq(campaignEvolutions.ownerId, userId)))
      .orderBy(desc(campaignEvolutions.createdAt));
    return { items: rows };
  }

  /** Approve/reject one change. Doesn't touch the live campaign - just records the owner's decision until "apply" is called. */
  async resolveChange(userId: string, id: string, changeId: string, decision: "approved" | "rejected") {
    const row = await this.get(userId, id);
    const decisions = { ...(row.decisions ?? {}), [changeId]: decision };
    const [updated] = await this.db.update(campaignEvolutions).set({ decisions: decisions as never }).where(eq(campaignEvolutions.id, id)).returning();
    return updated;
  }

  /**
   * Turns every APPROVED change in one version into a new draft campaign -
   * never mutates the live one. Reuses CampaignsService.create()'s full
   * plan/forecast/creative pipeline so nothing here duplicates it; approved
   * exact creative text is then layered on with updateCreatives().
   */
  async applyVersion(userId: string, id: string, versionId: string) {
    const row = await this.get(userId, id);
    if (row.status === "applied") throw new BadRequestException("This analysis has already been applied.");
    const versions = row.versions as unknown as EvolutionVersion[];
    const version = versions.find((v) => v.id === versionId);
    if (!version) throw new NotFoundException("That version could not be found.");
    const decisions = (row.decisions ?? {}) as Record<string, "approved" | "rejected">;
    const approved = version.changes.filter((c) => decisions[c.id] === "approved");
    if (!approved.length) throw new BadRequestException("Approve at least one change before applying.");

    const original = await this.campaigns.get(userId, row.campaignId);
    if (!original.listingId) throw new BadRequestException("Applying a redesign currently needs the original campaign to have a listing.");

    const extraPlaces = [...(original.extraPlaces ?? [])];
    const excludePlaces = [...(original.excludePlaces ?? [])];
    let budgetInr = Number(original.budgetInr);
    let goal = original.goal;
    const notesParts: string[] = [];
    const creativePatch: { headlines?: string[]; primaryTexts?: string[]; cta?: string } = {};

    for (const c of approved) {
      if (c.field === "Total budget") { const n = Number(c.proposedValue.replace(/[^\d.]/g, "")); if (n > 0) budgetInr = Math.round(n); }
      else if (c.field === "Campaign goal") goal = c.proposedValue.slice(0, 40);
      else if (c.field === "Excluded areas") notesParts.push(`Exclude: ${c.proposedValue}`);
      else if (c.field === "Extra targeted areas") notesParts.push(`Also target: ${c.proposedValue}`);
      else if (c.field === "Headline") creativePatch.headlines = [c.proposedValue];
      else if (c.field === "Primary text") creativePatch.primaryTexts = [c.proposedValue];
      else if (c.field === "Call to action") creativePatch.cta = c.proposedValue;
    }

    const draft = await this.campaigns.create(userId, {
      listingId: original.listingId, goal, budgetInr, days: Number(original.days),
      notes: `AI Campaign Evolution redesign (from "${original.name}"). ${notesParts.join(". ")}`.trim(),
      extraPlaces, excludePlaces,
    });
    if (creativePatch.headlines || creativePatch.primaryTexts || creativePatch.cta) {
      await this.campaigns.updateCreatives(userId, draft.id, creativePatch);
    }

    await this.db.update(campaignEvolutions).set({ status: "applied", appliedCampaignId: draft.id, appliedVersionId: version.id }).where(eq(campaignEvolutions.id, id));
    return { draftCampaignId: draft.id };
  }

  /**
   * Performance-Based Campaign Evolution (Section 9): a quick cost-per-
   * qualified-lead signal, available as soon as both campaigns have a
   * handful of qualified leads. Reuses CampaignsService.get() for both -
   * no separate metrics pipeline.
   */
  async outcome(userId: string, id: string) {
    const row = await this.get(userId, id);
    if (row.status !== "applied" || !row.appliedCampaignId) {
      return { available: false as const, reason: "No version has been applied yet - there's no variant campaign to compare against." };
    }
    const [original, variant] = await Promise.all([
      this.campaigns.get(userId, row.campaignId),
      this.campaigns.get(userId, row.appliedCampaignId),
    ]);
    return compareOutcome({
      originalSpendInr: Number(original.spendInr), originalQualifiedCount: Number(original.qualifiedCount),
      originalLeadsCount: Number(original.leadsCount), originalStatus: original.status,
      variantSpendInr: Number(variant.spendInr), variantQualifiedCount: Number(variant.qualifiedCount),
      variantLeadsCount: Number(variant.leadsCount), variantStatus: variant.status,
    });
  }

  /**
   * The Formal Experiment and Validation Engine (Section 13): the full
   * hypothesis/control/variant/objective/success-metric/minimum-evidence
   * report, with a real statistical significance test - a stricter,
   * slower-to-trigger companion to outcome() above, not a replacement
   * for it (outcome() is a quick signal; this one won't call a winner
   * without real evidence).
   */
  async experiment(userId: string, id: string) {
    const row = await this.get(userId, id);
    if (row.status !== "applied" || !row.appliedCampaignId) {
      return { available: false as const, reason: "No version has been applied yet - there's no variant campaign to run an experiment against." };
    }
    const versions = row.versions as unknown as EvolutionVersion[];
    const version = versions.find((v) => v.id === row.appliedVersionId);
    const hypothesis = version
      ? `${version.label}: ${version.summary}`
      : "Applying this evolution's approved changes improves qualified conversion rate.";

    const [original, variant] = await Promise.all([
      this.campaigns.get(userId, row.campaignId),
      this.campaigns.get(userId, row.appliedCampaignId),
    ]);
    if (variant.status === "draft" || variant.status === "review") {
      return { available: false as const, reason: "The variant campaign hasn't launched yet, so there's nothing to test." };
    }
    return runExperiment(hypothesis,
      { leadsCount: Number(original.leadsCount), qualifiedCount: Number(original.qualifiedCount), spendInr: Number(original.spendInr), budgetInr: Number(original.budgetInr), days: Number(original.days) },
      { leadsCount: Number(variant.leadsCount), qualifiedCount: Number(variant.qualifiedCount), spendInr: Number(variant.spendInr), budgetInr: Number(variant.budgetInr), days: Number(variant.days) },
    );
  }
}

export { inr };
