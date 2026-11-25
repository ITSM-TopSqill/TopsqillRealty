import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { MarketingAssistantService } from "../src/campaigns/marketing-assistant.service";

/** Every drizzle query in this service ends in .limit(n) - a single chainable stub covers every path (with or without .innerJoin). */
function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.innerJoin = () => self;
  self.where = () => self;
  self.orderBy = () => self;
  self.limit = () => Promise.resolve(rows);
  return self;
}

function makeService(opts: {
  claudeAvailable: boolean;
  dashboard?: Record<string, unknown>;
  list?: { items: Record<string, unknown>[] };
  selectRows?: Record<string, unknown>[];
  businessList?: { items: Record<string, unknown>[] };
  forecastAccuracy?: Record<string, unknown>;
  genericCampaignsList?: { items: Record<string, unknown>[] };
}) {
  const read = { select: () => chainable(opts.selectRows ?? []) };
  const claude = { available: opts.claudeAvailable, chat: vi.fn() };
  const campaigns = {
    list: vi.fn().mockResolvedValue(opts.list ?? { items: [] }),
    dashboard: vi.fn().mockResolvedValue(opts.dashboard ?? emptyDashboard),
    forecastAccuracy: vi.fn().mockResolvedValue(opts.forecastAccuracy ?? { available: false, reason: "Needs at least 2 completed campaigns with a pre-launch forecast to evaluate accuracy." }),
    get: vi.fn(),
    insights: vi.fn(),
  };
  const business = { list: vi.fn().mockResolvedValue(opts.businessList ?? { items: [] }) };
  const genericCampaigns = { list: vi.fn().mockResolvedValue(opts.genericCampaignsList ?? { items: [] }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new MarketingAssistantService(read as any, claude as any, campaigns as any, business as any, genericCampaigns as any);
  return { svc, claude, campaigns, business, genericCampaigns };
}

const emptyDashboard = {
  campaigns: [], totals: { spendInr: 0, leads: 0, qualified: 0 },
  bestPlatform: null, bestLocality: null, bestCampaign: null, pending: [],
};

describe("MarketingAssistantService", () => {
  it("falls back to a rules-based portfolio summary when Claude is unavailable", async () => {
    const { svc } = makeService({ claudeAvailable: false, dashboard: emptyDashboard });
    const res = await svc.ask("u1", "how much did we spend this month?");
    expect(res.source).toBe("rules");
    expect(res.reply).toContain("Campaigns running: 0");
    expect(res.reply).toContain("Total spend: ₹0");
  });

  it("never fabricates a best platform/locality/campaign when there isn't enough data", async () => {
    const { svc } = makeService({ claudeAvailable: false, dashboard: emptyDashboard });
    const res = await svc.ask("u1", "which locality works best?");
    expect(res.reply).toContain("Best platform: not enough data yet.");
    expect(res.reply).toContain("Best area: not enough data yet.");
    expect(res.reply).toContain("Best campaign: not enough data yet.");
  });

  it("reports real totals and a computed cost per qualified lead once there is data", async () => {
    const dashboard = {
      campaigns: [{ id: "c1", name: "Sunrise Towers", status: "active", spendInr: 10000, leadsCount: 20, qualifiedCount: 4 }],
      totals: { spendInr: 10000, leads: 20, qualified: 4 },
      bestPlatform: { platform: "meta", costPerQualifiedLeadInr: 2500 },
      bestLocality: { label: "Sector 65", qualified: 3, leads: 5 },
      bestCampaign: { id: "c1", name: "Sunrise Towers", costPerQualifiedLeadInr: 2500 },
      pending: [{ id: "r1" }],
    };
    const { svc } = makeService({ claudeAvailable: false, dashboard });
    const res = await svc.ask("u1", "how are we doing overall?");
    expect(res.reply).toContain("Total spend: ₹10,000");
    expect(res.reply).toContain("Cost per qualified lead: ₹2,500");
    expect(res.reply).toContain("Best platform: meta at ₹2,500/qualified lead.");
    expect(res.reply).toContain("Pending AI recommendations: 1.");
  });

  it("recommendations tool reports the campaign name and all eight parts for a pending recommendation", async () => {
    const row = {
      kind: "alert", campaignName: "Sunrise Towers", title: "Spending with no leads yet",
      why: "₹7,000 spent, 0 leads.", evidence: "All spend and leads since launch.", diagnosis: "Likely a targeting or creative problem.",
      impact: "Budget is at risk.", confidence: "high", action: "Check the ad.", risk: "Acting too fast could cut off a slow starter.",
      approval: "Review on the Insights page.", priority: 18,
    };
    const { svc } = makeService({ claudeAvailable: false, selectRows: [row] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).recommendationsText("u1", undefined, "pending");
    expect(text).toContain("Sunrise Towers");
    expect(text).toContain("Evidence: All spend and leads since launch.");
    expect(text).toContain("Likely cause: Likely a targeting or creative problem.");
    expect(text).toContain("Risk: Acting too fast could cut off a slow starter.");
    expect(text).toContain("Approval needed: Review on the Insights page.");
  });

  it("reports no recommendations for the requested status plainly, without fabricating one", async () => {
    const { svc } = makeService({ claudeAvailable: false, selectRows: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).recommendationsText("u1", undefined, "stale");
    expect(text).toBe("No stale AI recommendations right now.");
  });

  it("forecast_accuracy tool says plainly when there isn't enough completed history, never guessing a number", async () => {
    const { svc } = makeService({ claudeAvailable: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).forecastAccuracyText("u1");
    expect(text).toMatch(/needs at least 2 completed campaigns/i);
  });

  it("forecast_accuracy tool reports per-campaign spend/qualified error once there's enough history", async () => {
    const { svc } = makeService({
      claudeAvailable: false,
      forecastAccuracy: {
        available: true, evaluableCount: 2, averageCostErrorPct: 20,
        records: [
          { campaignId: "c1", name: "A", forecastQualified: 5, forecastCostPerQualifiedLeadInr: 2000, actualQualified: 4, actualSpendInr: 10000, actualCostPerQualifiedLeadInr: 2500, qualifiedErrorPct: -20, costErrorPct: 25 },
          { campaignId: "c2", name: "B", forecastQualified: 4, forecastCostPerQualifiedLeadInr: 2000, actualQualified: 5, actualSpendInr: 7500, actualCostPerQualifiedLeadInr: 1500, qualifiedErrorPct: 25, costErrorPct: -25 },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).forecastAccuracyText("u1");
    expect(text).toContain("average cost-per-qualified-lead error is 20%");
    expect(text).toContain("beat forecast on cost");
    expect(text).toContain("came in above forecast on cost");
  });

  it("my_businesses tool reports each business's real industry and recommended KPIs, never assuming real estate", async () => {
    const { svc } = makeService({
      claudeAvailable: false,
      businessList: {
        items: [{
          id: "b1", name: "Dental clinic chain",
          recommendations: { industry: { label: "Dental practices" }, objectives: ["Lead generation", "Appointment bookings"], conversionEvents: ["Appointment enquiries"], dashboardKpis: ["Appointment enquiries", "Bookings"], sensitive: true },
        }],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).myBusinessesText("u1");
    expect(text).toContain("Dental clinic chain");
    expect(text).toContain("Dental practices");
    expect(text).toContain("sensitive category");
  });

  it("my_businesses tool says plainly when the member has none, instead of inventing one", async () => {
    const { svc } = makeService({ claudeAvailable: false, businessList: { items: [] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).myBusinessesText("u1");
    expect(text).toMatch(/no non-real-estate business profiles yet/i);
  });

  it("business_marketing_plans tool lists a business's draft plans and labels them as drafts only", async () => {
    const { svc } = makeService({
      claudeAvailable: false,
      businessList: { items: [{ id: "b1", name: "Dental clinic chain" }] },
      genericCampaignsList: { items: [{ id: "p1", name: "New year push", objective: "Lead generation", conversionEvent: "Appointment enquiries", budgetInr: 10000, days: 15, status: "draft" }] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = await (svc as any).businessPlansText("u1", "Dental");
    expect(text).toContain("New year push");
    expect(text).toContain("draft only - not launched to any channel");
  });
});
