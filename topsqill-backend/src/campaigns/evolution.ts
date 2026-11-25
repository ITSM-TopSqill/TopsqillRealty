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
