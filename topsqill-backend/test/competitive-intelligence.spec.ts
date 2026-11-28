import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CompetitiveIntelligenceService } from "../src/competitive-intelligence/competitive-intelligence.service";

function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.where = () => self;
  self.orderBy = () => self;
  self.then = (resolve: (v: unknown) => void) => resolve(rows);
  return self;
}

function makeService(opts: {
  claudeEnabled: boolean; askResult?: string | null; existingWatches?: Record<string, unknown>[]; insertedWatch?: Record<string, unknown>;
  modules?: Partial<{
    discovery: unknown; analysis: unknown; gaps: unknown; strategies: unknown; concepts: unknown; audiences: unknown; genericCampaigns: unknown;
  }>;
}) {
  const db = {
    select: () => chainable(opts.existingWatches ?? []),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([opts.insertedWatch ?? { id: "w1", ownerId: "u1", searchTerms: "realty gurgaon" }]) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  const read = { select: () => chainable(opts.existingWatches ?? []) };
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled),
    ask: vi.fn().mockResolvedValue(opts.askResult ?? "Several ads emphasise site-visit CTAs."),
  };
  const emptyList = () => ({ list: vi.fn().mockResolvedValue({ items: [] }) });
  const m = opts.modules ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CompetitiveIntelligenceService(
    db as any, read as any, claude as any,
    (m.discovery ?? emptyList()) as any, (m.analysis ?? emptyList()) as any, (m.gaps ?? emptyList()) as any,
    (m.strategies ?? emptyList()) as any, (m.concepts ?? emptyList()) as any, (m.audiences ?? emptyList()) as any,
    (m.genericCampaigns ?? emptyList()) as any,
  );
}

describe("CompetitiveIntelligenceService.searchAds", () => {
  it("propagates a not-configured error as a clear client error rather than silently returning nothing", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.searchAds("u1", "realty gurgaon")).rejects.toThrow(/not configured|META_APP_ID/i);
  });
});

describe("CompetitiveIntelligenceService watch CRUD", () => {
  it("rejects an empty search term instead of saving a useless watch", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.createWatch("u1", "   ")).rejects.toThrow(/search term is needed/i);
  });

  it("rejects a duplicate watch for the same owner", async () => {
    const svc = makeService({ claudeEnabled: false, existingWatches: [{ searchTerms: "Realty Gurgaon" }] });
    await expect(svc.createWatch("u1", "realty gurgaon")).rejects.toThrow(/already watching/i);
  });

  it("caps the number of watches per owner, rather than letting the worker's load grow unbounded", async () => {
    const svc = makeService({ claudeEnabled: false, existingWatches: Array.from({ length: 10 }, (_, i) => ({ searchTerms: `term ${i}` })) });
    await expect(svc.createWatch("u1", "a new term")).rejects.toThrow(/up to 10/i);
  });

  it("saves a real watch when none of the limits are hit", async () => {
    const svc = makeService({ claudeEnabled: false, existingWatches: [] });
    const row = await svc.createWatch("u1", "realty gurgaon");
    expect(row.searchTerms).toBe("realty gurgaon");
  });
});

describe("pattern summary", () => {
  it("never fabricates a pattern summary when AI is off - says so honestly instead", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = makeService({ claudeEnabled: false }) as any;
    const summary = await svc.summarisePatterns("u1", "realty", [{ pageName: "A", headline: "h", body: "b", linkCaption: null, platforms: [], firstSeenAt: null, lastSeenAt: null, stillRunning: true, daysObserved: null, snapshotUrl: null }]);
    expect(summary.available).toBe(false);
    expect(summary.reason).toMatch(/ai is off/i);
  });

  it("returns no summary (not an empty fabricated one) when there are no results to analyse", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = makeService({ claudeEnabled: true }) as any;
    const summary = await svc.summarisePatterns("u1", "realty", []);
    expect(summary.available).toBe(false);
    expect(summary.reason).toMatch(/no ads found/i);
  });

  it("surfaces the AI summary when results exist and AI is on", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = makeService({ claudeEnabled: true, askResult: "Several ads lead with price transparency." }) as any;
    const summary = await svc.summarisePatterns("u1", "realty", [{ pageName: "A", headline: "h", body: "b", linkCaption: null, platforms: [], firstSeenAt: null, lastSeenAt: null, stillRunning: true, daysObserved: null, snapshotUrl: null }]);
    expect(summary.available).toBe(true);
    expect(summary.text).toContain("price transparency");
  });
});

describe("CompetitiveIntelligenceService.dashboard", () => {
  it("tallies approved/rejected/pending across every module - never recomputes a number, just counts what's already saved", async () => {
    const svc = makeService({
      claudeEnabled: false,
      modules: {
        discovery: { list: vi.fn().mockResolvedValue({ items: [{ status: "accepted" }, { status: "suggested" }, { status: "rejected" }, { status: "accepted" }] }) },
        analysis: { list: vi.fn().mockResolvedValue({ items: [{ id: "a1" }] }) },
        gaps: { list: vi.fn().mockResolvedValue({ items: [{ decisions: { o1: "approved", o2: "rejected" }, opportunities: [{ id: "o1" }, { id: "o2" }, { id: "o3" }] }] }) },
        strategies: { list: vi.fn().mockResolvedValue({ items: [] }) },
        concepts: { list: vi.fn().mockResolvedValue({ items: [] }) },
        audiences: { list: vi.fn().mockResolvedValue({ items: [] }) },
        genericCampaigns: { list: vi.fn().mockResolvedValue({ items: [{ sourceConceptId: "c1" }, { sourceConceptId: null }] }) },
      },
    });
    const row = await svc.dashboard("u1", "b1");
    expect(row.competitors).toEqual({ total: 4, accepted: 2, suggested: 1, rejected: 1 });
    expect(row.creativeAnalyses.total).toBe(1);
    expect(row.marketGaps).toEqual({ batches: 1, total: 3, approved: 1, rejected: 1, pending: 1 });
    expect(row.campaigns).toEqual({ total: 2, fromConcepts: 1 });
  });

  it("marks campaigns as unavailable without a business id, rather than guessing one", async () => {
    const svc = makeService({ claudeEnabled: false });
    const row = await svc.dashboard("u1");
    expect(row.campaigns).toEqual({ available: false, reason: expect.stringMatching(/pick a business/i) });
  });
});
