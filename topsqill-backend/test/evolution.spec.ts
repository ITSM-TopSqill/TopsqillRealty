import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { buildFallbackVersion, validateVersions, compareOutcome, type CampaignSnapshot, type EvolutionVersion, type OutcomeInput } from "../src/campaigns/evolution";
import { CampaignEvolutionService } from "../src/campaigns/evolution.service";

const baseSnapshot: CampaignSnapshot = {
  status: "active", goal: "Qualified buyers", budgetInr: 30000, days: 15,
  spendInr: 10000, leadsCount: 12, qualifiedCount: 5,
  headlines: ["3 BHK in Sector 65"], primaryTexts: ["Book a site visit"], cta: "Get details",
  extraPlaces: [], excludePlaces: [],
  platforms: [{ platform: "meta", spendPaise: 1000000, qualified: 5, leads: 12 }],
  localities: [{ label: "Sector 65", leads: 8, qualified: 1 }],
};

describe("buildFallbackVersion", () => {
  it("turns a real locality_low_perf recommendation into an appliable geographic change", () => {
    const v = buildFallbackVersion(baseSnapshot, [
      { category: "locality_low_perf", title: "Sector 65 is underperforming", why: "1/8 leads qualified", impact: "Low quality area", confidence: "medium", payload: { locality: "Sector 65" } },
    ]);
    expect(v.changes).toHaveLength(1);
    expect(v.changes[0].field).toBe("Excluded areas");
    expect(v.changes[0].proposedValue).toContain("Sector 65");
    expect(v.changes[0].evidence).toBe("1/8 leads qualified");   // never invents evidence beyond the real recommendation
  });

  it("returns an honest empty version when there's nothing structured to act on", () => {
    const v = buildFallbackVersion(baseSnapshot, [
      { category: "cost_above_forecast", title: "Cost is high", why: "...", impact: "...", confidence: "medium" },
    ]);
    expect(v.changes).toHaveLength(0);
    expect(v.summary).toMatch(/not enough structured data|isn't enough structured data/i);
  });

  it("returns an honest empty version with no pending recommendations at all", () => {
    const v = buildFallbackVersion(baseSnapshot, []);
    expect(v.changes).toHaveLength(0);
  });
});

describe("validateVersions", () => {
  it("rejects a change that targets a field that isn't real/appliable", () => {
    const bad: EvolutionVersion[] = [{ id: "v1", label: "x", summary: "x", changes: [
      { id: "c1", dimension: "creative", field: "Competitor positioning", currentValue: "a", proposedValue: "b", reason: "r", evidence: "e", expectedImpact: "i", confidence: "medium", risk: "r" },
    ] }];
    expect(() => validateVersions(bad)).toThrow();
  });

  it("accepts a version whose changes all target real fields", () => {
    const ok: EvolutionVersion[] = [{ id: "v1", label: "x", summary: "x", changes: [
      { id: "c1", dimension: "creative", field: "Headline", currentValue: "a", proposedValue: "b", reason: "r", evidence: "e", expectedImpact: "i", confidence: "medium", risk: "r" },
    ] }];
    expect(() => validateVersions(ok)).not.toThrow();
  });

  it("accepts a version with an empty changes array (an honest 'not enough evidence' answer)", () => {
    expect(() => validateVersions([{ id: "v1", label: "x", summary: "not enough data", changes: [] }])).not.toThrow();
  });
});

const baseOutcome: OutcomeInput = {
  originalSpendInr: 10000, originalQualifiedCount: 10, originalLeadsCount: 20, originalStatus: "completed",
  variantSpendInr: 10000, variantQualifiedCount: 10, variantLeadsCount: 20, variantStatus: "completed",
};

describe("compareOutcome", () => {
  it("refuses to compare when the variant hasn't launched yet", () => {
    const o = compareOutcome({ ...baseOutcome, variantStatus: "draft" });
    expect(o.available).toBe(false);
  });

  it("refuses to compare with too few qualified leads on either side", () => {
    expect(compareOutcome({ ...baseOutcome, originalQualifiedCount: 1 }).available).toBe(false);
    expect(compareOutcome({ ...baseOutcome, variantQualifiedCount: 1 }).available).toBe(false);
  });

  it("calls it inconclusive when the cost difference is small, never forcing a winner", () => {
    const o = compareOutcome({ ...baseOutcome, variantSpendInr: 10500 });   // ~5% worse
    if (!o.available) throw new Error("expected a result");
    expect(o.verdict).toBe("inconclusive");
  });

  it("declares the variant better only with a real, meaningful cost improvement", () => {
    const o = compareOutcome({ ...baseOutcome, variantSpendInr: 7000 });   // 1000/qualified -> 700/qualified, 30% better
    if (!o.available) throw new Error("expected a result");
    expect(o.verdict).toBe("variant_better");
    expect(o.percentDifference).toBeLessThan(0);
  });

  it("declares the original better when the variant costs meaningfully more per qualified lead", () => {
    const o = compareOutcome({ ...baseOutcome, variantSpendInr: 14000 });
    if (!o.available) throw new Error("expected a result");
    expect(o.verdict).toBe("original_better");
  });

  it("never reports high confidence - two different campaigns are never a clean controlled test", () => {
    const o = compareOutcome({ ...baseOutcome, originalQualifiedCount: 50, variantQualifiedCount: 50, variantSpendInr: 7000 });
    if (!o.available) throw new Error("expected a result");
    expect(o.confidence).not.toBe("high");
    expect(o.caveat).toMatch(/not a controlled a\/b test/i);
  });
});

function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.where = () => self;
  self.orderBy = () => self;
  self.limit = () => Promise.resolve(rows);
  self.returning = () => Promise.resolve(rows);
  self.then = (resolve: (v: unknown) => void) => resolve(rows);   // awaitable at any point in the chain, like a real drizzle query builder
  return self;
}

function makeService(opts: {
  claudeEnabled: boolean;
  jsonResult?: { data: unknown; source: "claude" | "rules" };
  campaignRow?: Record<string, unknown>;
  insightsResult?: Record<string, unknown>;
  pendingRecs?: Record<string, unknown>[];
  insertedRow?: Record<string, unknown>;
}) {
  const db = {
    insert: () => ({ values: () => chainable([opts.insertedRow ?? { id: "evo1", versions: [], decisions: {}, status: "proposed" }]) }),
    select: () => chainable(opts.pendingRecs ?? []),
    update: () => ({ set: () => ({ where: () => chainable([{ id: "evo1" }]) }) }),
  };
  const read = { select: () => chainable(opts.pendingRecs ?? []) };
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "rules" }),
  };
  const campaigns = {
    get: vi.fn().mockResolvedValue(opts.campaignRow ?? {
      id: "c1", status: "active", goal: "Qualified buyers", budgetInr: 30000, days: 15, spendInr: 10000, leadsCount: 12, qualifiedCount: 5,
      creatives: {}, extraPlaces: [], excludePlaces: [], listingId: "l1", name: "Test campaign",
    }),
    insights: vi.fn().mockResolvedValue(opts.insightsResult ?? { metrics: { platforms: [], localities: [] } }),
    create: vi.fn().mockResolvedValue({ id: "draft1" }),
    updateCreatives: vi.fn().mockResolvedValue({}),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new CampaignEvolutionService(db as any, read as any, claude as any, campaigns as any);
  return { svc, campaigns, claude };
}

describe("CampaignEvolutionService.analyse", () => {
  it("falls back to the rules-based version when AI is off, never fabricating a claude-sourced proposal", async () => {
    const { svc } = makeService({ claudeEnabled: false, insertedRow: { id: "evo1", source: "rules", versions: [{ id: "fallback", label: "x", summary: "x", changes: [] }] } });
    const row = await svc.analyse("u1", "c1");
    expect(row.source).toBe("rules");
  });

  it("falls back to rules if the model's proposal fails validation (an invented field)", async () => {
    const { svc } = makeService({
      claudeEnabled: true,
      jsonResult: { data: { versions: [{ id: "v1", label: "x", summary: "x", changes: [{ id: "c1", dimension: "creative", field: "Competitor pricing", currentValue: "a", proposedValue: "b", reason: "r", evidence: "e", expectedImpact: "i", confidence: "medium", risk: "r" }] }] }, source: "claude" },
      insertedRow: { id: "evo1", source: "rules", versions: [] },
    });
    const row = await svc.analyse("u1", "c1");
    expect(row.source).toBe("rules");
  });
});

describe("CampaignEvolutionService.applyVersion", () => {
  it("rejects applying when nothing was approved", async () => {
    const { svc } = makeService({ claudeEnabled: false });
    vi.spyOn(svc, "get").mockResolvedValue({ id: "evo1", campaignId: "c1", ownerId: "u1", status: "proposed", decisions: {}, versions: [{ id: "v1", label: "x", summary: "x", changes: [{ id: "c1", dimension: "creative", field: "Headline", currentValue: "a", proposedValue: "b", reason: "r", evidence: "e", expectedImpact: "i", confidence: "medium", risk: "r" }] }] } as never);
    await expect(svc.applyVersion("u1", "evo1", "v1")).rejects.toThrow(/approve at least one/i);
  });

  it("creates a new draft campaign from approved changes, reusing CampaignsService.create - never touching the live campaign", async () => {
    const { svc, campaigns } = makeService({ claudeEnabled: false });
    vi.spyOn(svc, "get").mockResolvedValue({
      id: "evo1", campaignId: "c1", ownerId: "u1", status: "proposed",
      decisions: { "c1": "approved" },
      versions: [{ id: "v1", label: "x", summary: "x", changes: [{ id: "c1", dimension: "creative", field: "Headline", currentValue: "Old headline", proposedValue: "New headline", reason: "r", evidence: "e", expectedImpact: "i", confidence: "medium", risk: "r" }] }],
    } as never);
    const result = await svc.applyVersion("u1", "evo1", "v1");
    expect(result.draftCampaignId).toBe("draft1");
    expect(campaigns.create).toHaveBeenCalledWith("u1", expect.objectContaining({ listingId: "l1" }));
    expect(campaigns.updateCreatives).toHaveBeenCalledWith("u1", "draft1", expect.objectContaining({ headlines: ["New headline"] }));
  });
});

describe("CampaignEvolutionService.outcome", () => {
  it("says plainly there's nothing to compare until a version has been applied", async () => {
    const { svc } = makeService({ claudeEnabled: false });
    vi.spyOn(svc, "get").mockResolvedValue({ id: "evo1", campaignId: "c1", ownerId: "u1", status: "proposed", appliedCampaignId: null } as never);
    const o = await svc.outcome("u1", "evo1");
    expect(o.available).toBe(false);
  });

  it("compares the real original and variant campaigns once applied, reusing CampaignsService.get for both", async () => {
    const { svc, campaigns } = makeService({ claudeEnabled: false });
    vi.spyOn(svc, "get").mockResolvedValue({ id: "evo1", campaignId: "c1", ownerId: "u1", status: "applied", appliedCampaignId: "draft1" } as never);
    campaigns.get
      .mockResolvedValueOnce({ spendInr: 10000, qualifiedCount: 10, leadsCount: 20, status: "completed" })
      .mockResolvedValueOnce({ spendInr: 7000, qualifiedCount: 10, leadsCount: 15, status: "completed" });
    const o = await svc.outcome("u1", "evo1");
    expect(campaigns.get).toHaveBeenCalledWith("u1", "c1");
    expect(campaigns.get).toHaveBeenCalledWith("u1", "draft1");
    if (!o.available) throw new Error("expected a result");
    expect(o.verdict).toBe("variant_better");
  });
});
