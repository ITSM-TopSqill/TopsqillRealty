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

/**
 * Formal Experiment and Validation Engine (Section 13): adds a real
 * two-proportion significance test (on qualified conversion rate) on top
 * of compareOutcome's cost signal, with an explicit minimum-evidence gate
 * and every field the spec asks an experiment to define - hypothesis,
 * control, variant, objective, success metric, minimum evidence, risk,
 * result, conclusion. Still never claims this isolates the specific
 * changes made: two different campaigns differ in more than one variable.
 */
export type ArmStats = { leadsCount: number; qualifiedCount: number; spendInr: number; budgetInr: number; days: number };
export type ArmReport = { leads: number; qualified: number; qualifiedRatePct: number; costPerQualifiedLeadInr: number | null; budgetInr: number; days: number };
export type StatisticalSignificance =
  | { available: true; zScore: number; pValue: number; significantAt95: boolean }
  | { available: false; reason: string };

export type ExperimentReport =
  | {
      available: true;
      hypothesis: string;
      objective: string;
      successMetric: string;
      minimumEvidencePerArm: number;
      meetsMinimumEvidence: boolean;
      control: ArmReport;
      variant: ArmReport;
      statisticalSignificance: StatisticalSignificance;
      secondaryMetric: { name: string; controlCostPerQualifiedLeadInr: number | null; variantCostPerQualifiedLeadInr: number | null; percentDifference: number | null };
      risk: string;
      conclusion: string;
    }
  | { available: false; reason: string };

/** Abramowitz & Stegun 7.1.26 - a standard, deterministic erf approximation (max error ~1.5e-7). No external stats library needed. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

/** Leads (not just qualified count) per arm, below which the normal approximation behind a two-proportion z-test isn't reliable - a real, commonly used floor, not an arbitrary one. */
const MIN_EVIDENCE_PER_ARM = 30;

export function runExperiment(hypothesis: string, control: ArmStats, variant: ArmStats): ExperimentReport {
  if (control.leadsCount === 0 || variant.leadsCount === 0) {
    return { available: false, reason: "Needs real lead volume on both the control and the variant before anything can be tested." };
  }
  const controlRate = control.qualifiedCount / control.leadsCount;
  const variantRate = variant.qualifiedCount / variant.leadsCount;
  const meetsMinimumEvidence = control.leadsCount >= MIN_EVIDENCE_PER_ARM && variant.leadsCount >= MIN_EVIDENCE_PER_ARM;

  let statisticalSignificance: StatisticalSignificance;
  if (!meetsMinimumEvidence) {
    statisticalSignificance = { available: false, reason: `Needs at least ${MIN_EVIDENCE_PER_ARM} leads on both sides for a meaningful significance test (control: ${control.leadsCount}, variant: ${variant.leadsCount}).` };
  } else {
    const pooledRate = (control.qualifiedCount + variant.qualifiedCount) / (control.leadsCount + variant.leadsCount);
    const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / control.leadsCount + 1 / variant.leadsCount));
    const z = se > 0 ? (variantRate - controlRate) / se : 0;
    const pValue = Math.round((2 * (1 - normalCdf(Math.abs(z)))) * 1000) / 1000;
    statisticalSignificance = { available: true, zScore: Math.round(z * 100) / 100, pValue, significantAt95: pValue < 0.05 };
  }

  const controlCost = control.qualifiedCount ? Math.round(control.spendInr / control.qualifiedCount) : null;
  const variantCost = variant.qualifiedCount ? Math.round(variant.spendInr / variant.qualifiedCount) : null;
  const percentDifference = controlCost != null && variantCost != null ? Math.round(((variantCost - controlCost) / controlCost) * 100) : null;

  const conclusion = !meetsMinimumEvidence
    ? "Not enough data yet to declare a winner - treat any difference so far as directional only."
    : statisticalSignificance.available && statisticalSignificance.significantAt95
      ? (variantRate > controlRate
          ? "The variant's qualified conversion rate is statistically significantly higher - a real signal, though not proof the specific changes caused it, since the two campaigns differ in other ways too."
          : "The control's qualified conversion rate is statistically significantly higher - the changes may have hurt lead quality, or something else about the variant underperformed.")
      : "No statistically significant difference in qualified conversion rate - the two are performing about the same on this metric so far.";

  return {
    available: true, hypothesis,
    objective: "Increase qualified leads without raising cost per qualified lead",
    successMetric: "Qualified conversion rate (qualified leads ÷ total leads)",
    minimumEvidencePerArm: MIN_EVIDENCE_PER_ARM, meetsMinimumEvidence,
    control: { leads: control.leadsCount, qualified: control.qualifiedCount, qualifiedRatePct: Math.round(controlRate * 1000) / 10, costPerQualifiedLeadInr: controlCost, budgetInr: control.budgetInr, days: control.days },
    variant: { leads: variant.leadsCount, qualified: variant.qualifiedCount, qualifiedRatePct: Math.round(variantRate * 1000) / 10, costPerQualifiedLeadInr: variantCost, budgetInr: variant.budgetInr, days: variant.days },
    statisticalSignificance,
    secondaryMetric: { name: "Cost per qualified lead", controlCostPerQualifiedLeadInr: controlCost, variantCostPerQualifiedLeadInr: variantCost, percentDifference },
    risk: "The control and variant are different campaigns, not a randomised split of the same audience at the same time - budget, dates, market conditions and anything else that differs between them can confound the result.",
    conclusion,
  };
}
