import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { AudienceStrategyService } from "../src/competitive-intelligence/audience-strategy.service";

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

const BUSINESS = { id: "b1", ownerId: "u1", name: "Acme Realty", industryId: "ecommerce_general", products: "Shoes", targetSegments: null, geographicMarkets: null, acquisitionGoals: null, existingChannels: [] };

const SAMPLE_SEGMENT = {
  id: "aud-1", name: "Repeat buyers who lapsed", whyValuable: "They already converted once - lower cost to win back.",
  availableSignals: "Matches your saved CRM segment 'Lapsed buyers'.", dataSource: "first-party CRM segment",
  providerCompatibility: "A custom audience uploaded from your own CRM list", audienceEstimate: "References your saved segment 'Lapsed buyers' - exact size not pulled here.",
  confidence: "medium", restrictions: "Needs consent-compliant contact data for upload.", creativeRecommendation: "A win-back offer.", testPlan: "Run a small win-back campaign to this list only.",
};

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  readQueue?: unknown[][];
}) {
  const db = {
    insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "as1", decisions: {}, ...v }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "as1" }]) }) }) }),
  };
  const read = queuedRead(opts.readQueue ?? [[BUSINESS], [], []]);
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AudienceStrategyService(db as any, read as any, claude as any);
}

describe("AudienceStrategyService.generate", () => {
  it("rejects when no business is given", async () => {
    const svc = makeService({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(svc.generate("u1", { businessId: "" } as any)).rejects.toThrow(/business profile is needed/i);
  });

  it("refuses when the business profile can't be found", async () => {
    const svc = makeService({ readQueue: [[]] });
    await expect(svc.generate("u1", { businessId: "b1" })).rejects.toThrow(/business profile could not be found/i);
  });

  it("refuses when AI is off rather than fabricating segments", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.generate("u1", { businessId: "b1" })).rejects.toThrow(/ai is off/i);
  });

  it("refuses when Claude returns nothing usable (never saves an empty/fabricated batch)", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { segments: [] }, source: "claude" } });
    await expect(svc.generate("u1", { businessId: "b1" })).rejects.toThrow(/couldn.t generate audience hypotheses/i);
  });

  it("rejects a segment with no data source cited rather than silently accepting it", async () => {
    const bad = { ...SAMPLE_SEGMENT, dataSource: "" };
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { segments: [bad] }, source: "claude" } });
    await expect(svc.generate("u1", { businessId: "b1" })).rejects.toThrow(/must cite a real data source/i);
  });

  it("persists a validated batch of segments, works fine with no competitors selected", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { segments: [SAMPLE_SEGMENT] }, source: "claude" } });
    const row = await svc.generate("u1", { businessId: "b1" });
    expect((row.segments as unknown as { name: string }[])[0].name).toBe("Repeat buyers who lapsed");
    expect(row.businessId).toBe("b1");
  });

  it("works fine with competitor ids given (as context, not a dependency)", async () => {
    const svc = makeService({
      readQueue: [[BUSINESS], [], [{ id: "c1", ownerId: "u1", name: "Rival Shoes", category: "direct", status: "accepted" }]],
      claudeEnabled: true, jsonResult: { data: { segments: [SAMPLE_SEGMENT] }, source: "claude" },
    });
    const row = await svc.generate("u1", { businessId: "b1", competitorIds: ["c1"] });
    expect(row.competitorIds).toEqual(["c1"]);
  });
});

describe("AudienceStrategyService.resolveSegment", () => {
  it("records an approve/reject decision by segment id", async () => {
    const svc = makeService({ readQueue: [[{ id: "as1", ownerId: "u1", decisions: {} }]] });
    const row = await svc.resolveSegment("u1", "as1", "aud-1", "approved");
    expect(row).toBeTruthy();
  });
});
