/**
 * Phase 5: turns a campaign's real numbers into alerts, suggestions and a
 * forecast. Deliberately rule-based, like src/leads/scoring.ts - every
 * condition here reads from real campaign/lead data the system already
 * has (spend, qualified leads, the pre-launch forecast, per-platform cost,
 * where leads actually come from); nothing is invented, and a rule simply
 * doesn't fire when there isn't enough data to support it.
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
  why: string;
  impact: string;
  confidence: "low" | "medium" | "high";
  action?: string;
  payload?: Record<string, unknown>;
};

const inr = (paise: number) => `₹${Math.round(paise).toLocaleString("en-IN")}`;
const rupeesToInr = (r: number) => `₹${Math.round(r).toLocaleString("en-IN")}`;

export function buildRecommendations(m: CampaignInsightInput): RecommendationCandidate[] {
  const out: RecommendationCandidate[] = [];
  const running = m.status === "active" || m.status === "paused";
  if (!running) return out;

  const spentPaise = m.spendInr * 100;
  const costPerQualified = m.qualifiedCount ? m.spendInr / m.qualifiedCount : null;

  // 1. Real money spent, zero leads at all - the clearest possible signal something's off.
  if (m.spendInr >= Math.max(m.budgetInr * 0.2, 1000) && m.leadsCount === 0) {
    out.push({
      kind: "alert", category: "spend_no_leads",
      title: "Spending with no leads yet",
      why: `${rupeesToInr(m.spendInr)} spent so far and 0 leads have come in.`,
      impact: "Budget is going out with nothing to show for it. Worth checking the ad's photo/headline, the targeting, or whether the listing itself still reads well.",
      confidence: "high",
    });
  }

  // 2. Actual cost per qualified lead vs. what was forecast when the campaign was built.
  if (costPerQualified != null && m.forecastCostPerQualifiedLeadInr && m.forecastCostPerQualifiedLeadInr > 0 && costPerQualified > m.forecastCostPerQualifiedLeadInr * 1.5) {
    out.push({
      kind: "alert", category: "cost_above_forecast",
      title: "Cost per qualified lead is running above plan",
      why: `Actual ${rupeesToInr(costPerQualified)} per qualified lead vs. the ${rupeesToInr(m.forecastCostPerQualifiedLeadInr)} forecast made when this campaign was built.`,
      impact: "At this rate, the rest of the budget will likely bring fewer qualified leads than planned.",
      confidence: "medium",
    });
  }

  // 3. Qualified rate in the second half of leads so far vs. the first half (both from real lead timestamps).
  if (m.earlyQualifiedRate != null && m.recentQualifiedRate != null && m.recentQualifiedRate < m.earlyQualifiedRate * 0.6) {
    out.push({
      kind: "alert", category: "qualified_dropping",
      title: "Qualified rate has dropped recently",
      why: `Recent leads are qualifying at ${Math.round(m.recentQualifiedRate * 100)}%, down from ${Math.round(m.earlyQualifiedRate * 100)}% earlier in this campaign.`,
      impact: "Lead volume may look fine while lead quality quietly slides - this is usually the first sign of that.",
      confidence: "medium",
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
          why: `${better}: ${inr(Math.min(metaCpl, googleCpl))}/qualified lead vs. ${worse}: ${inr(Math.max(metaCpl, googleCpl))}/qualified lead.`,
          impact: "Shifting budget toward the cheaper platform should bring more qualified leads for the same spend.",
          confidence: "medium",
          action: `Consider moving some budget from ${worse} to ${better}, or turn on "Let AI shift budget between Meta and Google" to do this automatically.`,
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
          why: `${l.label}: ${l.qualified}/${l.leads} leads qualified, vs. ${Math.round(avgRate * 100)}% campaign-wide.`,
          impact: "Leads from this area are rarely turning into qualified buyers for this listing.",
          confidence: l.leads >= 5 ? "medium" : "low",
          action: `Consider excluding ${l.label} or reducing its radius next time you edit targeting.`,
          payload: { locality: l.label },
        });
      } else if (rate >= avgRate * 1.6 && l.leads >= 3 && avgRate > 0) {
        out.push({
          kind: "suggestion", category: "locality_high_perf",
          title: `${l.label} is outperforming`,
          why: `${l.label}: ${l.qualified}/${l.leads} leads qualified, vs. ${Math.round(avgRate * 100)}% campaign-wide.`,
          impact: "This area is a strong source of real buyers for this listing.",
          confidence: l.leads >= 5 ? "medium" : "low",
          action: `Worth targeting ${l.label} directly (or nearby areas like it) in your next campaign.`,
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
      why: `${rupeesToInr(costPerQualified)} per qualified lead, well under the ${rupeesToInr(m.forecastCostPerQualifiedLeadInr)} forecast, with ${remainingDays} day${remainingDays === 1 ? "" : "s"} left.`,
      impact: "Adding budget now would likely bring more qualified leads at this same low cost, before the campaign ends.",
      confidence: "medium",
    });
  }

  // 7. Creative comparison needs other campaigns from the same owner to compare against - real, not invented.
  if (costPerQualified != null && m.ownerAvgCostPerQualifiedLeadInr && m.elapsedDays != null && m.elapsedDays >= 7 && costPerQualified > m.ownerAvgCostPerQualifiedLeadInr * 1.5) {
    out.push({
      kind: "suggestion", category: "creative_refresh",
      title: "This ad may be fatiguing",
      why: `${rupeesToInr(costPerQualified)} per qualified lead here, vs. your own ${rupeesToInr(m.ownerAvgCostPerQualifiedLeadInr)} average across other campaigns, after a week of running.`,
      impact: "The same creative running a while often slows down; a fresh photo, headline or video can bring the cost back down.",
      confidence: "low",
      action: "Try adding a new photo or video, or writing a new headline for this campaign's ads.",
    });
  }

  return out;
}

export type Forecast =
  | { available: true; method: string;
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
    optimistic: scenario(1.3),
    realistic: { leads: Math.round(realisticTotal), costPerQualifiedLeadInr: realisticTotal ? Math.round(m.budgetInr / realisticTotal) : null },
    conservative: scenario(0.7),
  };
}
