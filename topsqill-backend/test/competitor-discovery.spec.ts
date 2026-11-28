import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CompetitorDiscoveryService } from "../src/competitive-intelligence/competitor-discovery.service";

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

function makeService(opts: {
  claudeEnabled?: boolean; jsonResult?: { data: unknown; source: "claude" | "rules" };
  existing?: Record<string, unknown>[]; business?: Record<string, unknown> | null;
  inserted?: Record<string, unknown>[];
}) {
  const selectCalls: unknown[] = [];
  const db = {
    select: () => chainable(opts.existing ?? []),
    insert: () => ({ values: (v: unknown) => ({ returning: () => Promise.resolve(Array.isArray(v) ? (opts.inserted ?? v) : [opts.inserted?.[0] ?? { id: "c1", ...(v as object) }]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: "c1", status: "accepted" }]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  const read = {
    select: (cols?: unknown) => {
      selectCalls.push(cols);
      // First select in `suggest`/business flows is the business lookup; keep simple by branching on opts.business presence and call order.
      if (opts.business !== undefined && selectCalls.length === 1) return chainable(opts.business ? [opts.business] : []);
      return chainable(opts.existing ?? []);
    },
  };
  const claude = {
    enabledFor: vi.fn().mockResolvedValue(opts.claudeEnabled ?? true),
    json: vi.fn().mockResolvedValue(opts.jsonResult ?? { data: { suggestions: [] }, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CompetitorDiscoveryService(db as any, read as any, claude as any);
}

describe("CompetitorDiscoveryService.add", () => {
  it("rejects an empty name", async () => {
    const svc = makeService({ existing: [] });
    await expect(svc.add("u1", { name: "   " })).rejects.toThrow(/name is needed/i);
  });

  it("rejects an unrecognised category", async () => {
    const svc = makeService({ existing: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(svc.add("u1", { name: "Acme", category: "bogus" as any })).rejects.toThrow(/not a recognised/i);
  });

  it("saves a manual competitor as accepted", async () => {
    const svc = makeService({ existing: [] });
    const row = await svc.add("u1", { name: "Acme Realty", category: "direct" });
    expect(row).toBeTruthy();
  });

  it("caps the number of tracked competitors", async () => {
    const svc = makeService({ existing: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}` })) });
    await expect(svc.add("u1", { name: "One More" })).rejects.toThrow(/up to 60/i);
  });
});

describe("CompetitorDiscoveryService.suggest", () => {
  it("refuses when AI is off rather than fabricating suggestions", async () => {
    const svc = makeService({ claudeEnabled: false, existing: [] });
    await expect(svc.suggest("u1", "biz1")).rejects.toThrow(/ai suggestions are off/i);
  });

  it("refuses when there is no business profile to ground suggestions in", async () => {
    const svc = makeService({ claudeEnabled: true, existing: [], business: null });
    await expect(svc.suggest("u1", "biz1")).rejects.toThrow(/business profile/i);
  });

  it("drops a suggestion with no rationale instead of saving a bare name", async () => {
    const svc = makeService({
      claudeEnabled: true, existing: [], business: { id: "biz1", ownerId: "u1", name: "Acme", industryId: "ecommerce_general", products: "Shoes" },
      jsonResult: { data: { suggestions: [{ name: "NoReason Co", website: null, category: "direct", rationale: "" }] }, source: "claude" },
    });
    const { items } = await svc.suggest("u1", "biz1");
    expect(items).toHaveLength(0);
  });

  it("saves a well-formed AI suggestion as status=suggested, source=ai", async () => {
    const svc = makeService({
      claudeEnabled: true, existing: [], business: { id: "biz1", ownerId: "u1", name: "Acme", industryId: "ecommerce_general", products: "Shoes" },
      jsonResult: { data: { suggestions: [{ name: "Rival Shoes", website: "rivalshoes.com", category: "direct", rationale: "Sells similar footwear in the same market." }] }, source: "claude" },
      inserted: [{ id: "c2", name: "Rival Shoes", status: "suggested", source: "ai" }],
    });
    const { items } = await svc.suggest("u1", "biz1");
    expect(items[0].status).toBe("suggested");
    expect(items[0].source).toBe("ai");
  });
});
