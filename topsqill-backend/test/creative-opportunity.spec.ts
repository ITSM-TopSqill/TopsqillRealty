import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CreativeOpportunityService } from "../src/competitive-intelligence/creative-opportunity.service";

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

const APPROVED_GAP = {
  id: "mg1", ownerId: "u1", competitorIds: ["c1"],
  opportunities: [{ id: "gap-1", observation: "o", evidence: "e", opportunity: "Lead with quality", businessRelevance: "r", suggestedCampaign: "sc", suggestedCreative: "sv", suggestedAudience: "sa", confidence: "medium", risk: "risk", validationExperiment: "ve" }],
  decisions: { "gap-1": "approved" },
};

const UNAPPROVED_GAP = { ...APPROVED_GAP, decisions: {} };

const APPROVED_STRATEGY_BATCH = {
  id: "strat-batch-1", ownerId: "u1", competitorIds: ["c1"],
  strategies: [{ id: "strat-1", template: "quality", label: "Differentiate on quality", rationale: "r", positioning: "p", targetSegment: "t", keyMessage: "k", differentiation: "d", risk: "risk", confidence: "medium" }],
  decisions: { "strat-1": "approved" },
};

const SAMPLE_CONCEPT = {
  id: "concept-1", angle: "Quality over price", headlines: ["Built to last", "Quality you can see"],
  primaryTexts: ["Every unit uses certified materials."], ctaVariations: ["Book a site visit"],
  visualConcept: "A close-up of construction materials.", videoConcept: "A 15-second walkthrough of the build quality.",
  carouselConcept: "", format: "Premium positioning", confidence: "medium",
};

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  readQueue?: unknown[][];
}) {
  const db = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "cc1", decisions: {}, ...v }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "cc1" }]) }) }) }),
  };
  const read = queuedRead(opts.readQueue ?? [[APPROVED_GAP], [{ id: "c1", name: "Rival Realty" }]]);
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CreativeOpportunityService(db as any, read as any, claude as any);
}

describe("CreativeOpportunityService.generate", () => {
  it("rejects when neither a gap opportunity nor a strategy is given", async () => {
    const svc = makeService({});
    await expect(svc.generate("u1", {})).rejects.toThrow(/exactly one/i);
  });

  it("rejects when both a gap opportunity and a strategy are given", async () => {
    const svc = makeService({});
    await expect(svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1", competitiveStrategyId: "s1", strategyItemId: "strat-1" }))
      .rejects.toThrow(/exactly one/i);
  });

  it("refuses to generate from an opportunity that hasn't been approved", async () => {
    const svc = makeService({ readQueue: [[UNAPPROVED_GAP], []] });
    await expect(svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1" })).rejects.toThrow(/approve this opportunity first/i);
  });

  it("refuses to generate from a strategy that hasn't been approved", async () => {
    const svc = makeService({ readQueue: [[{ ...APPROVED_STRATEGY_BATCH, decisions: {} }], []] });
    await expect(svc.generate("u1", { competitiveStrategyId: "strat-batch-1", strategyItemId: "strat-1" })).rejects.toThrow(/approve this strategy first/i);
  });

  it("refuses when AI is off rather than fabricating concepts", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1" })).rejects.toThrow(/ai is off/i);
  });

  it("refuses when Claude returns nothing usable (never saves an empty/fabricated batch)", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { concepts: [] }, source: "claude" } });
    await expect(svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1" })).rejects.toThrow(/couldn.t generate concepts/i);
  });

  it("rejects a concept with no headlines rather than silently accepting it", async () => {
    const bad = { ...SAMPLE_CONCEPT, headlines: [] };
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { concepts: [bad] }, source: "claude" } });
    await expect(svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1" })).rejects.toThrow(/no headlines/i);
  });

  it("persists a validated batch grounded in an approved market-gap opportunity", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { concepts: [SAMPLE_CONCEPT] }, source: "claude" } });
    const row = await svc.generate("u1", { marketGapAnalysisId: "mg1", opportunityId: "gap-1" });
    expect((row.concepts as unknown as { angle: string }[])[0].angle).toBe("Quality over price");
    expect(row.opportunityId).toBe("gap-1");
  });

  it("persists a validated batch grounded in an approved strategy", async () => {
    const svc = makeService({
      readQueue: [[APPROVED_STRATEGY_BATCH], [{ id: "c1", name: "Rival Realty" }]],
      claudeEnabled: true, jsonResult: { data: { concepts: [SAMPLE_CONCEPT] }, source: "claude" },
    });
    const row = await svc.generate("u1", { competitiveStrategyId: "strat-batch-1", strategyItemId: "strat-1" });
    expect(row.strategyItemId).toBe("strat-1");
  });
});

describe("CreativeOpportunityService.resolveConcept", () => {
  it("records an approve/reject decision by concept id", async () => {
    const svc = makeService({ readQueue: [[{ id: "cc1", ownerId: "u1", decisions: {} }]] });
    const row = await svc.resolveConcept("u1", "cc1", "concept-1", "approved");
    expect(row).toBeTruthy();
  });
});
