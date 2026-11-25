import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { MarketingAssistantService } from "../src/campaigns/marketing-assistant.service";

function makeService(opts: {
  claudeAvailable: boolean;
  dashboard: Record<string, unknown>;
  list?: { items: Record<string, unknown>[] };
  selectRows?: Record<string, unknown>[];
}) {
  const read = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(opts.selectRows ?? []) }),
          limit: () => Promise.resolve(opts.selectRows ?? []),
        }),
      }),
    }),
  };
  const claude = { available: opts.claudeAvailable, chat: vi.fn() };
  const campaigns = {
    list: vi.fn().mockResolvedValue(opts.list ?? { items: [] }),
    dashboard: vi.fn().mockResolvedValue(opts.dashboard),
    get: vi.fn(),
    insights: vi.fn(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new MarketingAssistantService(read as any, claude as any, campaigns as any);
  return { svc, claude, campaigns };
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
});
