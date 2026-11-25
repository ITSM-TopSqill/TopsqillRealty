import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CommandCentreService } from "../src/command-centre/command-centre.service";

function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.where = () => self;
  self.then = (resolve: (v: unknown) => void) => resolve(rows);
  return self;
}

function makeService(opts: {
  dashboard?: Record<string, unknown>;
  forecastAccuracy?: Record<string, unknown>;
  businesses?: { items: Record<string, unknown>[] };
  segments?: { items: Record<string, unknown>[] };
  registry?: Record<string, unknown>[];
  evolutionRows?: Record<string, unknown>[];
}) {
  const read = { select: () => chainable(opts.evolutionRows ?? []) };
  const campaigns = {
    dashboard: vi.fn().mockResolvedValue(opts.dashboard ?? { campaigns: [], totals: { spendInr: 0, leads: 0, qualified: 0 }, bestPlatform: null, bestLocality: null, bestCampaign: null, pending: [] }),
    forecastAccuracy: vi.fn().mockResolvedValue(opts.forecastAccuracy ?? { available: false, reason: "Needs at least 2 completed campaigns with a pre-launch forecast to evaluate accuracy." }),
  };
  const business = { list: vi.fn().mockResolvedValue(opts.businesses ?? { items: [] }) };
  const customerIntel = { list: vi.fn().mockResolvedValue(opts.segments ?? { items: [] }) };
  const providers = { registry: vi.fn().mockResolvedValue(opts.registry ?? []) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CommandCentreService(read as any, campaigns as any, business as any, customerIntel as any, providers as any);
}

describe("CommandCentreService.overview", () => {
  it("never invents a metric - an empty account reports real zeros and honest fallbacks", async () => {
    const svc = makeService({});
    const o = await svc.overview("u1");
    expect(o.businessOverview.campaignsRunning).toBe(0);
    expect(o.businessOverview.totalSpendInr).toBe(0);
    expect(o.forecastAccuracy.available).toBe(false);
    expect(o.growthOpportunities).toEqual([]);
    expect(o.aiActivity.evolutionAnalysesRun).toBe(0);
  });

  it("reports real counts pulled straight from each owning service, not recomputed", async () => {
    const svc = makeService({
      dashboard: {
        campaigns: [{ id: "c1", status: "active" }, { id: "c2", status: "completed" }],
        totals: { spendInr: 5000, leads: 10, qualified: 3 },
        bestPlatform: { platform: "meta", costPerQualifiedLeadInr: 1500 },
        bestLocality: null, bestCampaign: null,
        pending: [{ id: "r1" }, { id: "r2" }],
      },
      businesses: { items: [{ id: "b1", name: "Dental clinic", recommendations: { industry: { label: "Dental practices" } } }] },
      segments: { items: [{ id: "s1", name: "Qualified" }] },
      registry: [{ id: "meta", name: "Meta", kind: "advertising", status: "production_verified" }, { id: "linkedin", name: "LinkedIn", kind: "advertising", status: "unsupported" }],
    });
    const o = await svc.overview("u1");
    expect(o.businessOverview.campaignsRunning).toBe(1);
    expect(o.businessOverview.campaignsTotal).toBe(2);
    expect(o.businessOverview.totalSpendInr).toBe(5000);
    expect(o.approvalCentre.pendingRecommendations).toBe(2);
    expect(o.integrations.connectedCount).toBe(1);
    expect(o.integrations.totalCount).toBe(2);
    expect(o.nonRealEstateBusinesses.count).toBe(1);
    expect(o.customerSegments.count).toBe(1);
  });

  it("counts evolution changes still awaiting a decision, and applied versions, from the real stored rows", async () => {
    const svc = makeService({
      evolutionRows: [
        { status: "proposed", decisions: { "v1-c1": "approved" }, versions: [{ changes: [{ id: "v1-c1" }, { id: "v1-c2" }] }] },
        { status: "applied", decisions: {}, versions: [{ changes: [{ id: "v2-c1" }] }] },
      ],
    });
    const o = await svc.overview("u1");
    expect(o.aiActivity.evolutionAnalysesRun).toBe(2);
    expect(o.aiActivity.evolutionVersionsApplied).toBe(1);
    expect(o.approvalCentre.pendingEvolutionChanges).toBe(2);   // v1-c2 (undecided) + v2-c1 (undecided, even though its evolution was applied)
  });
});
