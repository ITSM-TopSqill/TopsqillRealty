import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { MarketGapAnalysisService } from "../src/competitive-intelligence/market-gap.service";

function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.where = () => self;
  self.orderBy = () => self;
  self.limit = () => Promise.resolve(rows);
  self.then = (resolve: (v: unknown) => void) => resolve(rows);
  return self;
}

/** A queue-based `read.select()` mock: each call returns the next rows array in order. */
function queuedRead(queue: unknown[][]) {
  let i = 0;
  return { select: () => chainable(queue[i++] ?? []) };
}

const COMPETITOR = { id: "c1", ownerId: "u1", name: "Rival Realty", category: "direct", status: "accepted", rationale: "Same market", website: null };
const BUSINESS = { id: "b1", ownerId: "u1", name: "Acme Realty", industryId: "construction", products: "3 BHK flats", targetSegments: null, geographicMarkets: null, pricingNotes: null, businessModel: null, acquisitionGoals: null };

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  readQueue?: unknown[][];
}) {
  const db = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "mg1", decisions: {}, ...v }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "mg1" }]) }) }) }),
    select: () => chainable([]),
  };
  const read = queuedRead(opts.readQueue ?? [[COMPETITOR], [BUSINESS], []]);
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MarketGapAnalysisService(db as any, read as any, claude as any);
}

const SAMPLE_OPP = {
  id: "gap-1", observation: "Competitor leads with price.", evidence: "Rival Realty's ads emphasise '85L onwards'.",
  opportunity: "Lead with build quality instead.", businessRelevance: "We use better materials per our own listing notes.",
  suggestedCampaign: "Quality-led awareness campaign", suggestedCreative: "Before/after construction photos",
  suggestedAudience: "Buyers who toured Rival Realty's project", confidence: "medium",
  risk: "Quality claims must be substantiated.", validationExperiment: "Run a 2-week test campaign in one locality.",
};

describe("MarketGapAnalysisService.analyse", () => {
  it("rejects when no competitor is selected", async () => {
    const svc = makeService({});
    await expect(svc.analyse("u1", { competitorIds: [] })).rejects.toThrow(/at least one tracked competitor/i);
  });

  it("refuses when the selected competitor isn't accepted/tracked", async () => {
    const svc = makeService({ readQueue: [[], [BUSINESS], []] });
    await expect(svc.analyse("u1", { competitorIds: ["c1"] })).rejects.toThrow(/none of those competitors/i);
  });

  it("refuses when there's no business profile to ground opportunities in", async () => {
    const svc = makeService({ readQueue: [[COMPETITOR], [], []] });
    await expect(svc.analyse("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/business profile could not be found/i);
  });

  it("refuses when no business profile was given at all", async () => {
    const svc = makeService({ readQueue: [[COMPETITOR], []] });
    await expect(svc.analyse("u1", { competitorIds: ["c1"] })).rejects.toThrow(/add a business profile/i);
  });

  it("refuses when AI is off rather than fabricating opportunities", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.analyse("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/ai is off/i);
  });

  it("refuses when Claude returns nothing usable (never saves an empty/fabricated batch)", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { opportunities: [] }, source: "claude" } });
    await expect(svc.analyse("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/couldn.t generate opportunities/i);
  });

  it("persists a validated batch of opportunities", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { opportunities: [SAMPLE_OPP] }, source: "claude" } });
    const row = await svc.analyse("u1", { competitorIds: ["c1"], businessId: "b1" });
    expect((row.opportunities as unknown as { id: string }[])[0].id).toBe("gap-1");
    expect(row.competitorIds).toEqual(["c1"]);
  });

  it("rejects an opportunity with no evidence rather than silently accepting it", async () => {
    const bad = { ...SAMPLE_OPP, evidence: "" };
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { opportunities: [bad] }, source: "claude" } });
    await expect(svc.analyse("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/evidence is required/i);
  });
});

describe("MarketGapAnalysisService.resolveOpportunity", () => {
  it("records an approve/reject decision by opportunity id", async () => {
    const svc = makeService({ readQueue: [[{ id: "mg1", ownerId: "u1", decisions: {} }]] });
    const row = await svc.resolveOpportunity("u1", "mg1", "gap-1", "approved");
    expect(row).toBeTruthy();
  });
});
