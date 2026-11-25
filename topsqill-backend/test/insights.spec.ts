import { describe, it, expect } from "vitest";
import { buildRecommendations, forecastRemaining, type CampaignInsightInput } from "../src/campaigns/insights";

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
});
