/**
 * Phase 5: turns a campaign's real numbers into alerts, suggestions and a
 * forecast. Deliberately rule-based, like src/leads/scoring.ts - every
 * condition here reads from real campaign/lead data the system already
 * has (spend, qualified leads, the pre-launch forecast, per-platform cost,
 * where leads actually come from); nothing is invented, and a rule simply
 * doesn't fire when there isn't enough data to support it.
 *
 * Phase 5 additional requirements, Section 15: every recommendation follows
 * the fixed observation/evidence/diagnosis/recommendation/impact/confidence/
 * risk/approval structure, plus a deterministic priority score (impact x
 * confidence x urgency - never a black-box ranking) used to sort the list.
 */

export type PlatformMetric = { platform: "meta" | "google"; spendPaise: number; qualified: number; leads: number };
export type LocalityMetric = { label: string; leads: number; qualified: number };

export type CampaignInsightInput = {
  status: string;
  budgetInr: number;
  days: number;
  elapsedDays: number | null;          // null when not yet launched
  spendInr: number;
  leadsCount: number;
  qualifiedCount: number;
  forecastCostPerQualifiedLeadInr: number | null;   // from the plan made when the campaign was built
  platforms: PlatformMetric[];
  localities: LocalityMetric[];        // grouped by the lead's own city/locality, not ad-platform attribution
  earlyQualifiedRate: number | null;   // qualified ratio among the first half of leads, by arrival order
  recentQualifiedRate: number | null;  // qualified ratio among the second half
  clicks: number;
  impressions: number;
  ownerAvgCostPerQualifiedLeadInr: number | null;  // across the owner's OTHER campaigns with enough data
};

export type RecommendationCandidate = {
  kind: "alert" | "suggestion";
  category: string;
  title: string;
  /** 1. Observation: what the actual data shows. */
  observation: string;
  /** 2. Evidence: which records and reporting period support it. */
  evidence: string;
  /** 3. Diagnosis: why this might be happening. */
  diagnosis: string;
  /** 4. Recommendation: what action to consider (omitted when the finding is informational only). */
  recommendation?: string;
  /** 5. Expected impact: what measurable improvement might result. */
  impact: string;
  /** 6. Confidence: how reliable the analysis is. */
  confidence: "low" | "medium" | "high";
  /** 7. Risk: what could go wrong if acted on. */
  risk: string;
  /** 8. Approval: what permission is needed before anything changes. */
  approval: string;
  /** Deterministic ranking score (impact weight x confidence x urgency) - highest sorts first. */
  priority: number;
  payload?: Record<string, unknown>;
};

const inr = (paise: number) => `₹${Math.round(paise).toLocaleString("en-IN")}`;
const rupeesToInr = (r: number) => `₹${Math.round(r).toLocaleString("en-IN")}`;
const CONFIDENCE_WEIGHT = { high: 3, medium: 2, low: 1 } as const;
const NO_ACTION_APPROVAL = "None needed - this is informational only and changes nothing on its own.";
const MANUAL_APPROVAL = "Review on the Insights page; nothing changes until you act on it yourself (edit targeting, budget or creative).";

/** impactWeight: 1-3, how big a deal this category is when it fires at all. urgency: alert > suggestion. */
function priorityOf(confidence: RecommendationCandidate["confidence"], impactWeight: 1 | 2 | 3, kind: "alert" | "suggestion") {
  return CONFIDENCE_WEIGHT[confidence] * impactWeight * (kind === "alert" ? 2 : 1);
}

export function buildRecommendations(m: CampaignInsightInput): RecommendationCandidate[] {
  const out: RecommendationCandidate[] = [];
  const running = m.status === "active" || m.status === "paused";
  if (!running) return out;

  const spentPaise = m.spendInr * 100;
  const costPerQualified = m.qualifiedCount ? m.spendInr / m.qualifiedCount : null;
  const period = m.elapsedDays != null ? `over the ${m.elapsedDays} day${m.elapsedDays === 1 ? "" : "s"} since launch` : "since launch";

  // 1. Real money spent, zero leads at all - the clearest possible signal something's off.
  if (m.spendInr >= Math.max(m.budgetInr * 0.2, 1000) && m.leadsCount === 0) {
    out.push({
      kind: "alert", category: "spend_no_leads",
      title: "Spending with no leads yet",
      observation: `${rupeesToInr(m.spendInr)} spent so far and 0 leads have come in.`,
      evidence: `All campaign_deliveries spend and the leads table for this campaign, ${period}.`,
      diagnosis: "Usually the ad isn't reaching the right audience, the creative or offer isn't resonating, or there's a problem with the listing link or lead form itself.",
      recommendation: "Check the ad's photo/headline, the targeting, and whether the listing itself still reads well.",
      impact: "Budget is going out with nothing to show for it; fixing the likely cause now protects the rest of the budget.",
      confidence: "high",
      risk: "Pausing or changing targeting too quickly could interrupt a campaign that just needs more time to find its audience.",
      approval: MANUAL_APPROVAL,
      priority: priorityOf("high", 3, "alert"),
    });
  }

  // 2. Actual cost per qualified lead vs. what was forecast when the campaign was built.
  if (costPerQualified != null && m.forecastCostPerQualifiedLeadInr && m.forecastCostPerQualifiedLeadInr > 0 && costPerQualified > m.forecastCostPerQualifiedLeadInr * 1.5) {
    out.push({
      kind: "alert", category: "cost_above_forecast",
      title: "Cost per qualified lead is running above plan",
      observation: `Actual ${rupeesToInr(costPerQualified)} per qualified lead vs. the ${rupeesToInr(m.forecastCostPerQualifiedLeadInr)} forecast made when this campaign was built.`,
      evidence: `${m.qualifiedCount} qualified lead(s) against ${rupeesToInr(m.spendInr)} spend, ${period}, compared with the pre-launch plan's forecast.`,
      diagnosis: "The forecast assumed a steady qualification rate from launch; real audiences often take longer to find, or competition has driven costs up since the plan was made.",
      impact: "At this rate, the rest of the budget will likely bring fewer qualified leads than planned.",
      confidence: "medium",
      risk: "The rest of the campaign may still recover - this is a projection gap, not a guarantee it stays this way.",
      approval: NO_ACTION_APPROVAL,
      priority: priorityOf("medium", 2, "alert"),
    });
  }

  // 3. Qualified rate in the second half of leads so far vs. the first half (both from real lead timestamps).
  if (m.earlyQualifiedRate != null && m.recentQualifiedRate != null && m.recentQualifiedRate < m.earlyQualifiedRate * 0.6) {
    out.push({
      kind: "alert", category: "qualified_dropping",
      title: "Qualified rate has dropped recently",
      observation: `Recent leads are qualifying at ${Math.round(m.recentQualifiedRate * 100)}%, down from ${Math.round(m.earlyQualifiedRate * 100)}% earlier in this campaign.`,
      evidence: `The qualified rate of the first half vs. second half of this campaign's ${m.leadsCount} leads, by arrival order.`,
      diagnosis: "Often caused by audience saturation (the best-matched people have already seen and responded) or a seasonal/local shift in genuine demand.",
      impact: "Lead volume may look fine while lead quality quietly slides - this is usually the first sign of that.",
      confidence: "medium",
      risk: "A short dip can be normal variation rather than a lasting trend; watch a few more days before changing anything.",
      approval: NO_ACTION_APPROVAL,
      priority: priorityOf("medium", 2, "alert"),
    });
  }

  // 4. Meta vs Google: a real gap exists but auto-shifting isn't on (Phase 4 already handles it when it is).
  const meta = m.platforms.find((p) => p.platform === "meta");
  const google = m.platforms.find((p) => p.platform === "google");
  if (meta && google && meta.qualified + google.qualified >= 4) {
    const metaCpl = meta.qualified ? meta.spendPaise / meta.qualified : Infinity;
    const googleCpl = google.qualified ? google.spendPaise / google.qualified : Infinity;
    if (Number.isFinite(metaCpl) || Number.isFinite(googleCpl)) {
      const better = metaCpl < googleCpl ? "Meta (Facebook/Instagram)" : "Google Search";
      const worse = metaCpl < googleCpl ? "Google Search" : "Meta (Facebook/Instagram)";
      const gap = Math.abs(metaCpl - googleCpl) / Math.min(metaCpl, googleCpl);
      if (gap >= 0.15) {
        out.push({
          kind: "suggestion", category: "platform_shift",
          title: `${better} is bringing cheaper qualified leads`,
          observation: `${better}: ${inr(Math.min(metaCpl, googleCpl))}/qualified lead vs. ${worse}: ${inr(Math.max(metaCpl, googleCpl))}/qualified lead.`,
          evidence: `Spend and qualified-lead counts recorded per platform for this campaign (${meta.qualified + google.qualified} qualified leads combined), compared on the same attribution basis (leads credited to the platform that delivered them).`,
          diagnosis: "Meta and Google reach different intent levels - a persistent cost gap like this usually reflects which platform is actually finding motivated buyers for this specific listing.",
          recommendation: `Consider moving some budget from ${worse} to ${better}, or turn on "Let AI shift budget between Meta and Google" to do this automatically.`,
          impact: "Shifting budget toward the cheaper platform should bring more qualified leads for the same spend.",
          confidence: "medium",
          risk: "Shifting budget away from a platform too early can undo whatever delivery optimisation it had already built up.",
          approval: 'Turn on "Let AI shift budget between Meta and Google" to automate this, or adjust the split yourself - nothing changes on its own.',
          priority: priorityOf("medium", 2, "suggestion"),
        });
      }
    }
  }

  // 5. Where leads are actually coming from (the lead's own city/locality, not ad-platform attribution).
  const withEnough = m.localities.filter((l) => l.leads >= 2);
  if (withEnough.length >= 2 && m.leadsCount >= 6) {
    const avgRate = m.qualifiedCount / m.leadsCount;
    for (const l of withEnough) {
      const rate = l.qualified / l.leads;
      if (rate <= avgRate * 0.4 && l.leads >= 3) {
        out.push({
          kind: "suggestion", category: "locality_low_perf",
          title: `${l.label} is underperforming`,
          observation: `${l.label}: ${l.qualified}/${l.leads} leads qualified, vs. ${Math.round(avgRate * 100)}% campaign-wide.`,
          evidence: `All ${l.leads} leads recorded from ${l.label} on this campaign, ${period}.`,
          diagnosis: "Could be a price mismatch for that area, genuinely lower demand there, or the targeting radius pulling in people outside the real catchment.",
          recommendation: `Consider excluding ${l.label} or reducing its radius next time you edit targeting.`,
          impact: "Leads from this area are rarely turning into qualified buyers for this listing.",
          confidence: l.leads >= 5 ? "medium" : "low",
          risk: "Excluding an area removes it entirely - a temporary dip could be mistaken for a lasting pattern.",
          approval: MANUAL_APPROVAL,
          priority: priorityOf(l.leads >= 5 ? "medium" : "low", 1, "suggestion"),
          payload: { locality: l.label },
        });
      } else if (rate >= avgRate * 1.6 && l.leads >= 3 && avgRate > 0) {
        out.push({
          kind: "suggestion", category: "locality_high_perf",
          title: `${l.label} is outperforming`,
          observation: `${l.label}: ${l.qualified}/${l.leads} leads qualified, vs. ${Math.round(avgRate * 100)}% campaign-wide.`,
          evidence: `All ${l.leads} leads recorded from ${l.label} on this campaign, ${period}.`,
          diagnosis: "This area's buyers appear to match the listing's price point and type closely.",
          recommendation: `Worth targeting ${l.label} directly (or nearby areas like it) in your next campaign.`,
          impact: "This area is a strong source of real buyers for this listing.",
          confidence: l.leads >= 5 ? "medium" : "low",
          risk: "Past performance in an area doesn't guarantee it repeats in a new campaign or for a different listing.",
          approval: NO_ACTION_APPROVAL,
          priority: priorityOf(l.leads >= 5 ? "medium" : "low", 1, "suggestion"),
          payload: { locality: l.label },
        });
      }
    }
  }

  // 6. Performing well above plan, with budget and days left - a case for spending more, not less.
  const remainingDays = m.elapsedDays != null ? Math.max(m.days - m.elapsedDays, 0) : m.days;
  if (costPerQualified != null && m.forecastCostPerQualifiedLeadInr && costPerQualified < m.forecastCostPerQualifiedLeadInr * 0.7 && remainingDays >= 2 && m.spendInr < m.budgetInr * 0.6) {
    out.push({
      kind: "suggestion", category: "budget_opportunity",
      title: "This campaign is beating its own forecast",
      observation: `${rupeesToInr(costPerQualified)} per qualified lead, well under the ${rupeesToInr(m.forecastCostPerQualifiedLeadInr)} forecast, with ${remainingDays} day${remainingDays === 1 ? "" : "s"} left.`,
      evidence: `${m.qualifiedCount} qualified leads against ${rupeesToInr(m.spendInr)} spent of the ${rupeesToInr(m.budgetInr)} budget, ${period}.`,
      diagnosis: "The campaign is early enough, and performing well enough, that adding budget is likely to extend the same results rather than just raise costs.",
      impact: "Adding budget now would likely bring more qualified leads at this same low cost, before the campaign ends.",
      confidence: "medium",
      risk: "Increasing budget assumes the current pace continues; demand can slow as an area's pool of interested buyers is used up.",
      approval: MANUAL_APPROVAL,
      priority: priorityOf("medium", 2, "suggestion"),
    });
  }

  // 7. Creative comparison needs other campaigns from the same owner to compare against - real, not invented.
  if (costPerQualified != null && m.ownerAvgCostPerQualifiedLeadInr && m.elapsedDays != null && m.elapsedDays >= 7 && costPerQualified > m.ownerAvgCostPerQualifiedLeadInr * 1.5) {
    out.push({
      kind: "suggestion", category: "creative_refresh",
      title: "This ad may be fatiguing",
      observation: `${rupeesToInr(costPerQualified)} per qualified lead here, vs. your own ${rupeesToInr(m.ownerAvgCostPerQualifiedLeadInr)} average across other campaigns, after a week of running.`,
      evidence: `This campaign's cost per qualified lead compared against your other completed campaigns with qualified leads, after ${m.elapsedDays} days live.`,
      diagnosis: "The same creative shown repeatedly to the same audience tends to lose attention over time (ad fatigue), even when the underlying targeting is fine. This is a comparison against your own average, not a frequency/CTR-based fatigue measurement, which Topsqill doesn't yet ingest per creative.",
      recommendation: "Try adding a new photo or video, or writing a new headline for this campaign's ads.",
      impact: "The same creative running a while often slows down; a fresh photo, headline or video can bring the cost back down.",
      confidence: "low",
      risk: "A new creative has no track record yet and could perform worse at first; consider adding it alongside the original rather than replacing it outright.",
      approval: MANUAL_APPROVAL,
      priority: priorityOf("low", 1, "suggestion"),
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

export type Forecast =
  | { available: true; method: string; dataCoverage: string;
      optimistic: { leads: number; costPerQualifiedLeadInr: number | null };
      realistic: { leads: number; costPerQualifiedLeadInr: number | null };
      conservative: { leads: number; costPerQualifiedLeadInr: number | null } }
  | { available: false; reason: string };

/** A simple, explainable projection from this campaign's own pace so far - never a black-box model. */
export function forecastRemaining(m: CampaignInsightInput): Forecast {
  if (m.status !== "active" && m.status !== "paused") return { available: false, reason: "Only forecast while a campaign is running." };
  if (m.elapsedDays == null || m.elapsedDays < 2) return { available: false, reason: "Needs at least 2 days of live data." };
  if (m.qualifiedCount < 1) return { available: false, reason: "No qualified leads yet to project from." };

  const dailyQualified = m.qualifiedCount / m.elapsedDays;
  const remainingDays = Math.max(m.days - m.elapsedDays, 0);
  const projected = dailyQualified * remainingDays;
  const realisticTotal = m.qualifiedCount + projected;
  const scenario = (mult: number) => {
    const leads = Math.round(m.qualifiedCount + projected * mult);
    return { leads, costPerQualifiedLeadInr: leads ? Math.round(m.budgetInr / leads) : null };
  };
  return {
    available: true,
    method: `Based on ${dailyQualified.toFixed(2)} qualified leads/day over the ${m.elapsedDays} day${m.elapsedDays === 1 ? "" : "s"} so far, projected across the ${remainingDays} remaining day${remainingDays === 1 ? "" : "s"}.`,
    dataCoverage: `${m.elapsedDays} of ${m.days} days live, ${m.qualifiedCount} qualified lead${m.qualifiedCount === 1 ? "" : "s"} observed - ${m.elapsedDays < 5 || m.qualifiedCount < 3 ? "low" : m.elapsedDays < 10 || m.qualifiedCount < 6 ? "medium" : "high"} data coverage.`,
    optimistic: scenario(1.3),
    realistic: { leads: Math.round(realisticTotal), costPerQualifiedLeadInr: realisticTotal ? Math.round(m.budgetInr / realisticTotal) : null },
    conservative: scenario(0.7),
  };
}

/**
 * Phase 5 additional requirements, Sections 11 & 16 (lite): compares each
 * completed campaign's pre-launch forecast (stored on the campaign at build
 * time) against what actually happened, so forecast accuracy is tracked
 * over time instead of asserted. Never a trained model - a direct
 * forecast-vs-actual comparison on data Topsqill already has.
 */
export type ForecastAccuracyInput = {
  campaignId: string; name: string;
  forecastQualified: number; forecastCostPerQualifiedLeadInr: number;
  actualQualified: number; actualSpendInr: number;
};
export type ForecastAccuracyRecord = ForecastAccuracyInput & {
  actualCostPerQualifiedLeadInr: number | null;
  qualifiedErrorPct: number;
  costErrorPct: number | null;
};
export type ForecastAccuracySummary =
  | { available: true; records: ForecastAccuracyRecord[]; averageCostErrorPct: number | null; evaluableCount: number }
  | { available: false; reason: string };

export function evaluateForecastAccuracy(inputs: ForecastAccuracyInput[]): ForecastAccuracySummary {
  const usable = inputs.filter((i) => i.forecastQualified > 0 || i.actualQualified > 0);
  if (usable.length < 2) return { available: false, reason: "Needs at least 2 completed campaigns with a pre-launch forecast to evaluate accuracy." };

  const records: ForecastAccuracyRecord[] = usable.map((i) => {
    const actualCostPerQualifiedLeadInr = i.actualQualified > 0 ? Math.round(i.actualSpendInr / i.actualQualified) : null;
    const qualifiedErrorPct = i.forecastQualified > 0
      ? Math.round(((i.actualQualified - i.forecastQualified) / i.forecastQualified) * 100)
      : (i.actualQualified > 0 ? 100 : 0);
    const costErrorPct = actualCostPerQualifiedLeadInr != null && i.forecastCostPerQualifiedLeadInr > 0
      ? Math.round(((actualCostPerQualifiedLeadInr - i.forecastCostPerQualifiedLeadInr) / i.forecastCostPerQualifiedLeadInr) * 100)
      : null;
    return { ...i, actualCostPerQualifiedLeadInr, qualifiedErrorPct, costErrorPct };
  });
  const withCostError = records.filter((r) => r.costErrorPct != null);
  const averageCostErrorPct = withCostError.length
    ? Math.round(withCostError.reduce((s, r) => s + Math.abs(r.costErrorPct!), 0) / withCostError.length)
    : null;
  return { available: true, records, averageCostErrorPct, evaluableCount: withCostError.length };
}
