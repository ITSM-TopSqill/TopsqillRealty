import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { INDUSTRIES, industryById, industriesBySector, recommendationsFor } from "../src/business/industries";
import { BusinessService } from "../src/business/business.service";
import { GenericCampaignsService } from "../src/business/generic-campaigns.service";

describe("universal industry taxonomy", () => {
  it("covers every industry with a non-empty objective, conversion event and dashboard KPI list", () => {
    for (const i of INDUSTRIES) {
      expect(i.objectives.length).toBeGreaterThan(0);
      expect(i.conversionEvents.length).toBeGreaterThan(0);
      expect(i.dashboardKpis.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate industry ids", () => {
    const ids = INDUSTRIES.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to 'other' for an unknown industry id, never fabricating a match", () => {
    const rec = recommendationsFor("some-made-up-industry");
    expect(rec.industry.id).toBe("other");
  });

  it("flags sensitive categories (finance, healthcare) with a compliance note", () => {
    const rec = recommendationsFor("insurance");
    expect(rec.sensitive).toBe(true);
    expect(rec.complianceNote).toBeTruthy();
  });

  it("does not flag an ordinary category as sensitive", () => {
    const rec = recommendationsFor("ecommerce_general");
    expect(rec.sensitive).toBe(false);
    expect(rec.complianceNote).toBeNull();
  });

  it("groups industries by sector with every industry accounted for", () => {
    const groups = industriesBySector();
    const total = groups.reduce((n, g) => n + g.industries.length, 0);
    expect(total).toBe(INDUSTRIES.length);
  });

  it("industryById returns null for an unknown id (caller decides the fallback)", () => {
    expect(industryById("nope")).toBeNull();
    expect(industryById("saas")?.label).toBe("SaaS & software companies");
  });
});

function makeBusinessService(claudeAvailable: boolean) {
  const db = { insert: vi.fn() };
  const read = { select: vi.fn() };
  const claude = { available: claudeAvailable, enabledFor: vi.fn().mockResolvedValue(claudeAvailable), json: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new BusinessService(db as any, read as any, claude as any), claude };
}

describe("BusinessService.draftFromDescription", () => {
  it("falls back to a low-confidence 'other' draft without fabricating an industry when AI is off", async () => {
    const { svc } = makeBusinessService(false);
    const draft = await svc.draftFromDescription("u1", "We sell handmade candles online.");
    expect(draft.industryId).toBe("other");
    expect(draft.industryGuess.confidence).toBe("low");
    expect(draft.description).toContain("candles");
  });

  it("rejects an empty description instead of guessing", async () => {
    const { svc } = makeBusinessService(false);
    await expect(svc.draftFromDescription("u1", "   ")).rejects.toThrow();
  });
});

describe("GenericCampaignsService.create", () => {
  it("rejects an objective that isn't recommended for the business's industry", async () => {
    const business = { id: "b1", ownerId: "u1", industryId: "ecommerce_general" };
    const read = { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([business]) }) }) }) };
    const db = { insert: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new GenericCampaignsService(db as any, read as any);
    await expect(svc.create("u1", {
      businessId: "b1", name: "Launch", objective: "Appointment bookings", conversionEvent: "Purchases", budgetInr: 5000,
    })).rejects.toThrow(/recommended for/);
  });

  it("rejects a non-positive budget", async () => {
    const business = { id: "b1", ownerId: "u1", industryId: "ecommerce_general" };
    const read = { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([business]) }) }) }) };
    const db = { insert: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new GenericCampaignsService(db as any, read as any);
    await expect(svc.create("u1", {
      businessId: "b1", name: "Launch", objective: "Sales", conversionEvent: "Purchases", budgetInr: 0,
    })).rejects.toThrow(/Budget/);
  });
});
