import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

const adLibraryMock = vi.hoisted(() => ({ searchAdLibrary: vi.fn() }));
vi.mock("../src/competitive-intelligence/ad-library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/competitive-intelligence/ad-library")>();
  return { ...actual, searchAdLibrary: adLibraryMock.searchAdLibrary };
});

import { CompetitorCreativeAnalysisService } from "../src/competitive-intelligence/competitor-creative-analysis.service";

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

const SAMPLE_AD = {
  pageName: "Acme Realty", headline: "3 BHK from 85L", body: "Book a site visit today", linkCaption: null,
  platforms: ["facebook"], firstSeenAt: "2026-01-01T00:00:00Z", lastSeenAt: null, stillRunning: true, daysObserved: 30, snapshotUrl: null,
};

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  competitorRow?: Record<string, unknown> | null;
}) {
  const db = { insert: () => ({ values: (v: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "a1", ...v }]) }) }) };
  const read = { select: () => chainable(opts.competitorRow ? [opts.competitorRow] : []) };
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CompetitorCreativeAnalysisService(db as any, read as any, claude as any);
}

describe("CompetitorCreativeAnalysisService.analyse", () => {
  it("rejects an empty search term", async () => {
    const svc = makeService({});
    await expect(svc.analyse("u1", "   ")).rejects.toThrow(/search term/i);
  });

  it("refuses a competitorId that doesn't belong to the owner", async () => {
    const svc = makeService({ competitorRow: null });
    await expect(svc.analyse("u1", "acme", "c-not-mine")).rejects.toThrow(/competitor could not be found/i);
  });

  it("refuses when AI is off rather than falling back to a fabricated analysis", async () => {
    const svc = makeService({ claudeEnabled: false });
    await expect(svc.analyse("u1", "acme realty")).rejects.toThrow(/ai is off/i);
  });

  it("refuses when no ads are found - nothing to analyse", async () => {
    adLibraryMock.searchAdLibrary.mockResolvedValueOnce([]);
    const svc = makeService({ claudeEnabled: true });
    await expect(svc.analyse("u1", "a very obscure brand")).rejects.toThrow(/no currently or recently running ads/i);
  });

  it("refuses when Claude falls back to rules (never saves a placeholder as real analysis)", async () => {
    adLibraryMock.searchAdLibrary.mockResolvedValueOnce([SAMPLE_AD]);
    const svc = makeService({ claudeEnabled: true, jsonResult: { data: { visualStrategy: "", copyStrategy: "", commercialStrategy: "", classification: [], confidence: "low" }, source: "rules" } });
    await expect(svc.analyse("u1", "acme realty")).rejects.toThrow(/couldn.t generate an analysis/i);
  });

  it("persists a structured analysis with only recognised classifications and a valid confidence", async () => {
    adLibraryMock.searchAdLibrary.mockResolvedValueOnce([SAMPLE_AD]);
    const svc = makeService({
      claudeEnabled: true,
      jsonResult: {
        data: {
          visualStrategy: "Mostly static images of the property exterior.",
          copyStrategy: "Leads with price, ends with a site-visit CTA.",
          commercialStrategy: "Positions on affordability versus nearby projects.",
          classification: ["Price promotion", "NotARealLabel"],
          confidence: "high",
        },
        source: "claude",
      },
    });
    const row = await svc.analyse("u1", "acme realty");
    expect(row.visualStrategy).toMatch(/static images/);
    expect(row.classification).toEqual(["Price promotion"]);
    expect(row.confidence).toBe("high");
    expect(row.adCount).toBe(1);
    expect(row.inputSource).toBe("meta_api");
  });
});

describe("CompetitorCreativeAnalysisService.analyseManual", () => {
  beforeEach(() => adLibraryMock.searchAdLibrary.mockClear());

  it("rejects an empty ad list", async () => {
    const svc = makeService({});
    await expect(svc.analyseManual("u1", "Acme", [])).rejects.toThrow(/at least one ad/i);
  });

  it("drops an ad with no advertiser name or with neither headline nor body", async () => {
    const svc = makeService({});
    await expect(svc.analyseManual("u1", "Acme", [{ pageName: "", headline: "x" }, { pageName: "Acme" }])).rejects.toThrow(/at least one ad/i);
  });

  it("never calls Meta's Ad Library - manual ads are analysed as given", async () => {
    const svc = makeService({
      claudeEnabled: true,
      jsonResult: { data: { visualStrategy: "A single static image.", copyStrategy: "Price-led headline.", commercialStrategy: "Value positioning.", classification: ["Price promotion"], confidence: "low" }, source: "claude" },
    });
    const row = await svc.analyseManual("u1", "Acme Realty", [{ pageName: "Acme Realty", headline: "3 BHK from 85L", body: "Book a visit" }]);
    expect(adLibraryMock.searchAdLibrary).not.toHaveBeenCalled();
    expect(row.inputSource).toBe("manual");
    expect(row.adCount).toBe(1);
  });

  it("refuses a competitorId that doesn't belong to the owner", async () => {
    const svc = makeService({ competitorRow: null });
    await expect(svc.analyseManual("u1", "Acme", [{ pageName: "Acme", body: "x" }], "c-not-mine")).rejects.toThrow(/competitor could not be found/i);
  });
});
