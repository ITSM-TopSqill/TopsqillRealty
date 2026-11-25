import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CompetitiveIntelligenceService } from "../src/competitive-intelligence/competitive-intelligence.service";

function makeService(opts: { claudeEnabled: boolean; askResult?: string | null }) {
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled),
    ask: vi.fn().mockResolvedValue(opts.askResult ?? "Several ads emphasise site-visit CTAs."),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CompetitiveIntelligenceService(claude as any);
}

describe("CompetitiveIntelligenceService.searchAds", () => {
  it("propagates a not-configured error as a clear client error rather than silently returning nothing", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.searchAds("u1", "realty gurgaon")).rejects.toThrow(/not configured|META_APP_ID/i);
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
