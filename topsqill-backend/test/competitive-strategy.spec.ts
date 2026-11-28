import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CompetitiveStrategyService } from "../src/competitive-intelligence/competitive-strategy.service";

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

function queuedRead(queue: unknown[][]) {
  let i = 0;
  return { select: () => chainable(queue[i++] ?? []) };
}

const COMPETITOR = { id: "c1", ownerId: "u1", name: "Rival Realty", category: "direct", status: "accepted", rationale: null };
const BUSINESS = { id: "b1", ownerId: "u1", name: "Acme Realty", industryId: "construction", products: "3 BHK flats", targetSegments: null, pricingNotes: null };

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  readQueue?: unknown[][];
}) {
  const db = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "strat-batch-1", decisions: {}, ...v }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "strat-batch-1" }]) }) }) }),
  };
  const read = queuedRead(opts.readQueue ?? [[COMPETITOR], [BUSINESS]]);
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CompetitiveStrategyService(db as any, read as any, claude as any);
}

const SAMPLE_STRATEGY = {
  id: "strat-1", template: "quality", label: "Differentiate on product quality",
  rationale: "Our materials are a real, documented differentiator versus Rival Realty's budget positioning.",
  positioning: "Premium build quality at a mid-market price.", targetSegment: "Upgrade buyers in the same locality",
  keyMessage: "Better construction, same budget.", differentiation: "Rival Realty competes on price alone.",
  risk: "Quality claims must be substantiated with real specs.", confidence: "medium",
};

describe("CompetitiveStrategyService.generate", () => {
  it("rejects when no competitor is selected", async () => {
    const svc = makeService({});
    await expect(svc.generate("u1", { competitorIds: [] })).rejects.toThrow(/at least one tracked competitor/i);
  });

  it("refuses when the selected competitor isn't accepted/tracked", async () => {
    const svc = makeService({ readQueue: [[], [BUSINESS]] });
    await expect(svc.generate("u1", { competitorIds: ["c1"] })).rejects.toThrow(/none of those competitors/i);
  });

  it("refuses when there's no business profile to ground strategies in", async () => {
    const svc = makeService({ readQueue: [[COMPETITOR]] });
    await expect(svc.generate("u1", { competitorIds: ["c1"] })).rejects.toThrow(/add a business profile/i);
  });

  it("refuses when AI is off rather than fabricating a strategy", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.generate("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/ai is off/i);
  });

  it("refuses when Claude returns no strategies (never saves an empty/fabricated batch)", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { strategies: [] }, source: "claude" } });
    await expect(svc.generate("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/couldn.t generate strategies/i);
  });

  it("rejects a strategy that names a template not in the fixed list", async () => {
    const bad = { ...SAMPLE_STRATEGY, template: "made_up_template" };
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { strategies: [bad] }, source: "claude" } });
    await expect(svc.generate("u1", { competitorIds: ["c1"], businessId: "b1" })).rejects.toThrow(/isn.t a real strategy template/i);
  });

  it("persists a validated batch of 1-3 strategies", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { strategies: [SAMPLE_STRATEGY] }, source: "claude" } });
    const row = await svc.generate("u1", { competitorIds: ["c1"], businessId: "b1" });
    expect((row.strategies as unknown as { template: string }[])[0].template).toBe("quality");
  });

  it("only builds on APPROVED opportunities from a referenced market-gap analysis, not rejected ones", async () => {
    const gapRow = {
      id: "mg1", ownerId: "u1",
      opportunities: [
        { id: "gap-1", opportunity: "Lead with quality", evidence: "real evidence" },
        { id: "gap-2", opportunity: "Should never appear", evidence: "real evidence" },
      ],
      decisions: { "gap-1": "approved", "gap-2": "rejected" },
    };
    const svc = makeService({
      readQueue: [[COMPETITOR], [BUSINESS], [gapRow]],
      claudeEnabled: true,
      jsonResult: { data: { strategies: [SAMPLE_STRATEGY] }, source: "claude" },
    });
    const row = await svc.generate("u1", { competitorIds: ["c1"], businessId: "b1", marketGapAnalysisId: "mg1" });
    expect(row).toBeTruthy();
  });
});

describe("CompetitiveStrategyService.resolveStrategy", () => {
  it("records an approve/reject decision by strategy id", async () => {
    const svc = makeService({ readQueue: [[{ id: "strat-batch-1", ownerId: "u1", decisions: {} }]] });
    const row = await svc.resolveStrategy("u1", "strat-batch-1", "strat-1", "approved");
    expect(row).toBeTruthy();
  });
});
