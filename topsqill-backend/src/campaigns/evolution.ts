/**
 * AI Campaign Evolution (first-party slice): analyse an existing campaign's
 * own real config and performance, and propose concrete, structured
 * redesign changes - never referencing a competitor, an industry benchmark,
 * or any data source this build doesn't actually have connected. See the
 * provider capability registry for what IS connected; competitor ad
 * discovery (Meta Ad Library etc.) was explicitly scoped out of this round.
 */

export type EvolutionDimension = "audience" | "creative" | "messaging" | "budget" | "geographic";
export type Confidence = "low" | "medium" | "high";

export type EvolutionChange = {
  id: string;
  dimension: EvolutionDimension;
  field: string;
  currentValue: string;
  proposedValue: string;
  reason: string;
  evidence: string;
  expectedImpact: string;
  confidence: Confidence;
  risk: string;
};

export type EvolutionVersion = { id: string; label: string; summary: string; changes: EvolutionChange[] };

export type CampaignSnapshot = {
  status: string;
  goal: string;
  budgetInr: number;
  days: number;
  spendInr: number;
  leadsCount: number;
  qualifiedCount: number;
  headlines: string[];
  primaryTexts: string[];
  cta: string | null;
  extraPlaces: string[];
  excludePlaces: string[];
  platforms: { platform: string; spendPaise: number; qualified: number; leads: number }[];
  localities: { label: string; leads: number; qualified: number }[];
};

/**
 * Deterministic fallback used when AI is unavailable: turns the campaign's
 * OWN already-computed Phase 5 recommendations (locality under-performance
 * specifically, since that's the one category with a structured,
 * directly-appliable payload) into real, appliable changes. Never
 * fabricates a reason beyond what Phase 5 already established.
 */
export function buildFallbackVersion(
  snapshot: CampaignSnapshot,
  pendingRecommendations: { category: string; title: string; why: string; impact: string; confidence: Confidence; risk?: string | null; payload?: Record<string, unknown> | null }[],
): EvolutionVersion {
  const changes: EvolutionChange[] = [];
  let n = 0;
  for (const r of pendingRecommendations) {
    if (r.category === "locality_low_perf" && r.payload?.locality && typeof r.payload.locality === "string") {
      n++;
      changes.push({
        id: `fallback-${n}`, dimension: "geographic", field: "Excluded areas",
        currentValue: snapshot.excludePlaces.join(", ") || "None",
        proposedValue: [...snapshot.excludePlaces, r.payload.locality].join(", "),
        reason: r.why, evidence: r.why, expectedImpact: r.impact, confidence: r.confidence,
        risk: r.risk ?? "Excluding an area removes it entirely - a temporary dip could be a lasting pattern or just noise.",
      });
    }
  }
  const summary = changes.length
    ? "Built from this campaign's own existing AI recommendations (Phase 5) - AI redesign is off, so only the already-flagged, structured locality issues could be turned into a direct change."
    : "AI is off, and there isn't enough structured data from this campaign's existing recommendations to propose a safe automatic change. Review the AI alerts on the Insights page for manual action instead.";
  return { id: "fallback", label: "Address existing flagged issues", summary, changes };
}

/** Every change must reference a real field this campaign actually has - never invented. */
const VALID_FIELDS = new Set(["Headline", "Primary text", "Call to action", "Daily budget pace", "Total budget", "Excluded areas", "Extra targeted areas", "Campaign goal"]);

export function validateVersions(versions: EvolutionVersion[]) {
  for (const v of versions) {
    if (!v.changes.length) continue;
    for (const c of v.changes) {
      if (!VALID_FIELDS.has(c.field)) throw new Error(`"${c.field}" isn't a real, appliable campaign field.`);
      if (!["low", "medium", "high"].includes(c.confidence)) throw new Error(`Invalid confidence "${c.confidence}".`);
    }
  }
}

/**
 * Performance-Based Campaign Evolution + the Experiment/Validation Engine
 * (Sections 9 & 13), scoped honestly: a direct comparison between the
 * original campaign and the "variant" draft an evolution's approved
 * changes became, once BOTH have run enough to say anything - never a
 * declared winner on thin data, and never a claim this isolates the
 * change from everything else that can differ between two campaigns
 * (budget, dates, audience size).
 */
export type OutcomeInput = {
  originalSpendInr: number; originalQualifiedCount: number; originalLeadsCount: number; originalStatus: string;
  variantSpendInr: number; variantQualifiedCount: number; variantLeadsCount: number; variantStatus: string;
};
export type OutcomeVerdict = "variant_better" | "original_better" | "inconclusive";
export type EvolutionOutcome =
  | {
      available: true; verdict: OutcomeVerdict;
      originalCostPerQualifiedLeadInr: number; variantCostPerQualifiedLeadInr: number;
      percentDifference: number; confidence: Confidence;
      caveat: string;
    }
  | { available: false; reason: string };

const MIN_QUALIFIED_FOR_COMPARISON = 3;

export function compareOutcome(input: OutcomeInput): EvolutionOutcome {
  if (input.variantStatus === "draft" || input.variantStatus === "review") {
    return { available: false, reason: "The variant campaign hasn't launched yet, so there's nothing to compare." };
  }
  if (input.originalQualifiedCount < MIN_QUALIFIED_FOR_COMPARISON || input.variantQualifiedCount < MIN_QUALIFIED_FOR_COMPARISON) {
    return { available: false, reason: `Needs at least ${MIN_QUALIFIED_FOR_COMPARISON} qualified leads on both the original and the variant to compare honestly - not there yet.` };
  }
  const originalCost = input.originalSpendInr / input.originalQualifiedCount;
  const variantCost = input.variantSpendInr / input.variantQualifiedCount;
  const percentDifference = Math.round(((variantCost - originalCost) / originalCost) * 100);
  const bothHaveDecentVolume = input.originalQualifiedCount >= 8 && input.variantQualifiedCount >= 8;
  const confidence: Confidence = bothHaveDecentVolume ? "medium" : "low";   // never "high" - two campaigns differ in more than the changes made
  const verdict: OutcomeVerdict = Math.abs(percentDifference) < 15 ? "inconclusive" : percentDifference < 0 ? "variant_better" : "original_better";
  return {
    available: true, verdict,
    originalCostPerQualifiedLeadInr: Math.round(originalCost), variantCostPerQualifiedLeadInr: Math.round(variantCost),
    percentDifference, confidence,
    caveat: "This compares two different campaigns, not a controlled A/B test on the same audience at the same time - budget, dates and market conditions can differ too. Treat this as a signal, not proof the specific changes caused the difference.",
  };
}
