import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { LandingPageIntelligenceService } from "../src/competitive-intelligence/landing-page-intelligence.service";

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

const PAGE_TEXT = "Move in by Diwali. Book a free site visit today and get 10% off. ".repeat(10);

const GOOD_BREAKDOWN = {
  headline: "Move in by Diwali", subheadline: "Limited units left",
  keyMessages: ["Fast possession", "Prime location"], offers: ["10% early-bird discount"],
  ctas: ["Book a free site visit"], trustSignals: ["RERA registered"], pricingMentioned: "Starts at 85L, shown openly",
  formFields: ["name", "phone"], confidence: "high",
};

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  competitorRow?: Record<string, unknown> | null;
  fetchResult?: { page: { title: string; description: string; text: string } | null; via: string | null; error: string };
}) {
  const db = { insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "lp1", ...v }]) }) }) };
  const read = { select: () => chainable(opts.competitorRow ? [opts.competitorRow] : []) };
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  const pageFetcher = {
    fetch: vi.fn().mockResolvedValue(opts.fetchResult ?? { page: { title: "Acme Realty", description: "", text: PAGE_TEXT }, via: "direct", error: "" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new LandingPageIntelligenceService(db as any, read as any, claude as any, pageFetcher as any);
}

describe("LandingPageIntelligenceService.analyse", () => {
  it("rejects a link that isn't http(s) or points to a private address", async () => {
    const svc = makeService({});
    await expect(svc.analyse("u1", "ftp://example.com")).rejects.toThrow(/http and https/i);
    await expect(svc.analyse("u1", "http://localhost")).rejects.toThrow(/private address/i);
  });

  it("refuses a competitorId that doesn't belong to the owner", async () => {
    const svc = makeService({ competitorRow: null });
    await expect(svc.analyse("u1", "https://rival.example", "c-not-mine")).rejects.toThrow(/competitor could not be found/i);
  });

  it("refuses when AI is off rather than falling back to a fabricated breakdown", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.analyse("u1", "https://rival.example")).rejects.toThrow(/ai is off/i);
  });

  it("refuses when the page couldn't be read with enough real text", async () => {
    const svc = makeService({ claudeEnabled: true, fetchResult: { page: null, via: null, error: "That link points to a private address." } });
    await expect(svc.analyse("u1", "https://rival.example")).rejects.toThrow(/private address/i);
  });

  it("refuses when the fetched page has too little text to analyse honestly", async () => {
    const svc = makeService({ claudeEnabled: true, fetchResult: { page: { title: "x", description: "", text: "too short" }, via: "direct", error: "" } });
    await expect(svc.analyse("u1", "https://rival.example")).rejects.toThrow(/couldn.t read enough real text/i);
  });

  it("refuses when Claude falls back to rules (never saves a placeholder as real analysis)", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { ...GOOD_BREAKDOWN, headline: "" }, source: "rules" } });
    await expect(svc.analyse("u1", "https://rival.example")).rejects.toThrow(/couldn.t generate a landing-page analysis/i);
  });

  it("persists a structured breakdown with a valid confidence, source and inputSource", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: GOOD_BREAKDOWN, source: "claude" } });
    const row = await svc.analyse("u1", "https://rival.example/landing");
    expect(row.headline).toBe("Move in by Diwali");
    expect(row.offers).toEqual(["10% early-bird discount"]);
    expect(row.confidence).toBe("high");
    expect(row.inputSource).toBe("fetched");
    expect(row.url).toBe("https://rival.example/landing");
  });
});

describe("LandingPageIntelligenceService.analyseManual", () => {
  it("rejects text that's too short to analyse honestly", async () => {
    const svc = makeService({});
    await expect(svc.analyseManual("u1", "too short")).rejects.toThrow(/paste at least/i);
  });

  it("never calls the page fetcher - manual text is analysed as given", async () => {
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: GOOD_BREAKDOWN, source: "claude" } });
    const row = await svc.analyseManual("u1", PAGE_TEXT, "https://rival.example");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((svc as any).pageFetcher.fetch).not.toHaveBeenCalled();
    expect(row.inputSource).toBe("manual");
    expect(row.headline).toBe("Move in by Diwali");
  });

  it("refuses a competitorId that doesn't belong to the owner", async () => {
    const svc = makeService({ competitorRow: null });
    await expect(svc.analyseManual("u1", PAGE_TEXT, undefined, "c-not-mine")).rejects.toThrow(/competitor could not be found/i);
  });
});
