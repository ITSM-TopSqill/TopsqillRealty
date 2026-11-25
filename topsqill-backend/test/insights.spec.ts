import { describe, it, expect } from "vitest";
import { buildRecommendations, forecastRemaining, evaluateForecastAccuracy, type CampaignInsightInput } from "../src/campaigns/insights";

const base: CampaignInsightInput = {
  status: "active", budgetInr: 30000, days: 15, elapsedDays: 5,
  spendInr: 5000, leadsCount: 0, qualifiedCount: 0,
  forecastCostPerQualifiedLeadInr: null,
  platforms: [], localities: [],
  earlyQualifiedRate: null, recentQualifiedRate: null,
  clicks: 0, impressions: 0, ownerAvgCostPerQualifiedLeadInr: null,
};

describe("buildRecommendations", () => {
  it("flags real spend with zero leads", () => {
    const out = buildRecommendations({ ...base, spendInr: 7000 });
    expect(out.find((r) => r.category === "spend_no_leads")).toBeTruthy();
  });

  it("does not flag spend-with-no-leads below the threshold, or once leads exist", () => {
    expect(buildRecommendations({ ...base, spendInr: 1000 }).find((r) => r.category === "spend_no_leads")).toBeFalsy();
    expect(buildRecommendations({ ...base, spendInr: 7000, leadsCount: 2 }).find((r) => r.category === "spend_no_leads")).toBeFalsy();
  });

  it("flags cost per qualified lead well above the pre-launch forecast", () => {
    const out = buildRecommendations({ ...base, spendInr: 15000, qualifiedCount: 3, forecastCostPerQualifiedLeadInr: 2000 });
    // 15000/3 = 5000, which is 2.5x the 2000 forecast
    expect(out.find((r) => r.category === "cost_above_forecast")).toBeTruthy();
  });

  it("does not flag cost-above-forecast when actual is close to or better than forecast", () => {
    const out = buildRecommendations({ ...base, spendInr: 6000, qualifiedCount: 3, forecastCostPerQualifiedLeadInr: 2000 });
    expect(out.find((r) => r.category === "cost_above_forecast")).toBeFalsy();
  });

  it("flags a dropping qualified rate between the early and recent half of leads", () => {
    const out = buildRecommendations({ ...base, leadsCount: 10, earlyQualifiedRate: 0.8, recentQualifiedRate: 0.2 });
    expect(out.find((r) => r.category === "qualified_dropping")).toBeTruthy();
  });

  it("does not flag qualified_dropping when the recent rate is close to or above the early rate", () => {
    const out = buildRecommendations({ ...base, leadsCount: 10, earlyQualifiedRate: 0.5, recentQualifiedRate: 0.45 });
    expect(out.find((r) => r.category === "qualified_dropping")).toBeFalsy();
  });

  it("suggests shifting budget toward the cheaper platform once there's a real gap and enough data", () => {
    const out = buildRecommendations({
      ...base,
      platforms: [
        { platform: "meta", spendPaise: 500000, qualified: 5, leads: 10 },      // ₹1,000/qualified
        { platform: "google", spendPaise: 500000, qualified: 2, leads: 5 },     // ₹2,500/qualified
      ],
    });
    const rec = out.find((r) => r.category === "platform_shift");
    expect(rec).toBeTruthy();
    expect(rec!.title).toContain("Meta");
  });

  it("does not suggest a platform shift when there isn't enough qualified-lead data yet", () => {
    const out = buildRecommendations({
      ...base,
      platforms: [
        { platform: "meta", spendPaise: 100000, qualified: 1, leads: 3 },
        { platform: "google", spendPaise: 100000, qualified: 1, leads: 2 },
      ],
    });
    expect(out.find((r) => r.category === "platform_shift")).toBeFalsy();
  });

  it("flags an underperforming locality and praises an outperforming one", () => {
    const out = buildRecommendations({
      ...base, leadsCount: 10, qualifiedCount: 4,
      localities: [
        { label: "Area A", leads: 4, qualified: 0 },   // 0% vs 40% campaign-wide
        { label: "Area B", leads: 4, qualified: 4 },   // 100% vs 40% campaign-wide
      ],
    });
    expect(out.find((r) => r.category === "locality_low_perf" && r.title.includes("Area A"))).toBeTruthy();
    expect(out.find((r) => r.category === "locality_high_perf" && r.title.includes("Area B"))).toBeTruthy();
  });

  it("suggests more budget when beating forecast with days and budget left", () => {
    const out = buildRecommendations({
      ...base, days: 15, elapsedDays: 5, budgetInr: 30000, spendInr: 10000,
      qualifiedCount: 10, forecastCostPerQualifiedLeadInr: 2000,   // actual = 1000/qualified, well under forecast
    });
    expect(out.find((r) => r.category === "budget_opportunity")).toBeTruthy();
  });

  it("suggests a creative refresh only once a week has passed and the owner's own average is known", () => {
    const withHistory = buildRecommendations({ ...base, elapsedDays: 8, spendInr: 15000, qualifiedCount: 3, ownerAvgCostPerQualifiedLeadInr: 2000 });
    expect(withHistory.find((r) => r.category === "creative_refresh")).toBeTruthy();
    const tooSoon = buildRecommendations({ ...base, elapsedDays: 2, spendInr: 15000, qualifiedCount: 3, ownerAvgCostPerQualifiedLeadInr: 2000 });
    expect(tooSoon.find((r) => r.category === "creative_refresh")).toBeFalsy();
  });

  it("never recommends anything for a campaign that isn't running", () => {
    expect(buildRecommendations({ ...base, status: "draft", spendInr: 20000 })).toHaveLength(0);
    expect(buildRecommendations({ ...base, status: "completed", spendInr: 20000 })).toHaveLength(0);
  });

  it("gives every recommendation the full observation/evidence/diagnosis/impact/confidence/risk/approval/priority structure", () => {
    const out = buildRecommendations({ ...base, spendInr: 7000 });
    for (const r of out) {
      expect(r.observation).toBeTruthy();
      expect(r.evidence).toBeTruthy();
      expect(r.diagnosis).toBeTruthy();
      expect(r.impact).toBeTruthy();
      expect(r.risk).toBeTruthy();
      expect(r.approval).toBeTruthy();
      expect(typeof r.priority).toBe("number");
      expect(r.priority).toBeGreaterThan(0);
    }
  });

  it("sorts recommendations by priority, highest first, with a high-confidence alert outranking a low-confidence suggestion", () => {
    const out = buildRecommendations({
      ...base, leadsCount: 10, qualifiedCount: 4,
      localities: [
        { label: "Area A", leads: 4, qualified: 0 },   // low-confidence suggestion (leads < 5)
        { label: "Area B", leads: 4, qualified: 4 },
      ],
      earlyQualifiedRate: 0.8, recentQualifiedRate: 0.2,   // medium-confidence alert: qualified_dropping
    });
    for (let i = 1; i < out.length; i++) expect(out[i - 1].priority).toBeGreaterThanOrEqual(out[i].priority);
    expect(out[0].category).toBe("qualified_dropping");   // the alert should outrank the low-confidence locality suggestions
  });

  it("marks an informational-only finding's approval as none needed, and an actionable one as needing review", () => {
    const costAbove = buildRecommendations({ ...base, spendInr: 15000, qualifiedCount: 3, forecastCostPerQualifiedLeadInr: 2000 })
      .find((r) => r.category === "cost_above_forecast")!;
    expect(costAbove.approval).toMatch(/none needed/i);
    const spendNoLeads = buildRecommendations({ ...base, spendInr: 7000 }).find((r) => r.category === "spend_no_leads")!;
    expect(spendNoLeads.approval).toMatch(/review/i);
  });
});

describe("forecastRemaining", () => {
  it("is unavailable before 2 days of live data, or with no qualified leads yet", () => {
    expect(forecastRemaining({ ...base, elapsedDays: 1, qualifiedCount: 1 }).available).toBe(false);
    expect(forecastRemaining({ ...base, elapsedDays: 5, qualifiedCount: 0 }).available).toBe(false);
    expect(forecastRemaining({ ...base, status: "draft", elapsedDays: 5, qualifiedCount: 1 }).available).toBe(false);
  });

  it("projects optimistic >= realistic >= conservative from the campaign's own pace", () => {
    const f = forecastRemaining({ ...base, days: 15, elapsedDays: 5, budgetInr: 30000, qualifiedCount: 5 });
    if (!f.available) throw new Error("expected a forecast");
    expect(f.optimistic.leads).toBeGreaterThanOrEqual(f.realistic.leads);
    expect(f.realistic.leads).toBeGreaterThanOrEqual(f.conservative.leads);
    expect(f.realistic.leads).toBeGreaterThan(5);   // some growth projected over the remaining 10 days
  });

  it("reports data coverage alongside the forecast, lower with less data", () => {
    const thin = forecastRemaining({ ...base, days: 15, elapsedDays: 2, budgetInr: 30000, qualifiedCount: 1 });
    const thick = forecastRemaining({ ...base, days: 15, elapsedDays: 12, budgetInr: 30000, qualifiedCount: 10 });
    if (!thin.available || !thick.available) throw new Error("expected both to forecast");
    expect(thin.dataCoverage).toMatch(/low/i);
    expect(thick.dataCoverage).toMatch(/high/i);
  });
});

describe("evaluateForecastAccuracy", () => {
  it("is unavailable with fewer than 2 evaluable completed campaigns", () => {
    expect(evaluateForecastAccuracy([]).available).toBe(false);
    expect(evaluateForecastAccuracy([
      { campaignId: "c1", name: "A", forecastQualified: 5, forecastCostPerQualifiedLeadInr: 2000, actualQualified: 4, actualSpendInr: 9000 },
    ]).available).toBe(false);
  });

  it("computes a per-campaign cost error and an average, never fabricating a number it can't compute", () => {
    const r = evaluateForecastAccuracy([
      { campaignId: "c1", name: "A", forecastQualified: 5, forecastCostPerQualifiedLeadInr: 2000, actualQualified: 4, actualSpendInr: 10000 },  // actual 2500/qualified, +25%
      { campaignId: "c2", name: "B", forecastQualified: 4, forecastCostPerQualifiedLeadInr: 2000, actualQualified: 0, actualSpendInr: 3000 },     // no qualified leads - no actual cost per lead
    ]);
    if (!r.available) throw new Error("expected an evaluation");
    expect(r.records.find((x) => x.campaignId === "c1")!.costErrorPct).toBe(25);
    expect(r.records.find((x) => x.campaignId === "c2")!.costErrorPct).toBeNull();
    expect(r.evaluableCount).toBe(1);
    expect(r.averageCostErrorPct).toBe(25);
  });
});
