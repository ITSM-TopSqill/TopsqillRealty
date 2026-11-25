import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
});

import { CustomerIntelligenceService } from "../src/customer-intelligence/customer-intelligence.service";

function chainable(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {};
  self.from = () => self;
  self.where = () => self;
  self.orderBy = () => self;
  self.limit = () => Promise.resolve(rows);
  return self;
}

function makeService(opts: { claudeAvailable: boolean; leadRows?: Record<string, unknown>[]; jsonResult?: Record<string, unknown> }) {
  const read = { select: () => chainable(opts.leadRows ?? []) };
  const db = { select: () => chainable([]), insert: vi.fn(), delete: vi.fn() };
  const claude = {
    available: opts.claudeAvailable,
    enabledFor: vi.fn().mockResolvedValue(opts.claudeAvailable),
    json: vi.fn().mockResolvedValue({ data: opts.jsonResult ?? {}, source: "claude" }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CustomerIntelligenceService(db as any, read as any, claude as any);
}

describe("CustomerIntelligenceService.draftFromDescription", () => {
  it("rejects an empty description instead of guessing", async () => {
    const svc = makeService({ claudeAvailable: false });
    await expect(svc.draftFromDescription("u1", "  ")).rejects.toThrow();
  });

  it("falls back honestly when AI is off, rather than fabricating conditions", async () => {
    const svc = makeService({ claudeAvailable: false });
    const draft = await svc.draftFromDescription("u1", "Find premium buyers");
    expect(draft.conditions).toEqual([]);
    expect(draft.explanation).toMatch(/ai is off/i);
  });

  it("redirects a request for data Topsqill doesn't have (e.g. 'American Express cardholders') instead of inventing a matching field", async () => {
    const svc = makeService({
      claudeAvailable: true,
      jsonResult: {
        conditions: [],
        explanation: "",
        unavailableRequest: "Topsqill has no data on credit card ownership. Using declared budget (budget_max) is the closest real signal for a premium buyer.",
      },
    });
    const draft = await svc.draftFromDescription("u1", "Find me American Express cardholders");
    expect(draft.conditions).toEqual([]);
    expect(draft.unavailableRequest).toMatch(/no data on credit card ownership/i);
  });

  it("drops any condition the model invents that isn't a real differentiator, rather than saving garbage", async () => {
    const svc = makeService({
      claudeAvailable: true,
      jsonResult: {
        conditions: [
          { differentiatorId: "lead_qualified", operator: "eq", value: true },
          { differentiatorId: "net_worth", operator: "gte", value: 1_000_000 },   // not a real differentiator - must be dropped
        ],
        explanation: "Qualified leads.",
        unavailableRequest: null,
      },
    });
    const draft = await svc.draftFromDescription("u1", "Find qualified, wealthy buyers");
    expect(draft.conditions).toHaveLength(1);
    expect(draft.conditions[0].differentiatorId).toBe("lead_qualified");
  });
});

describe("CustomerIntelligenceService.create", () => {
  it("rejects an invalid segment definition instead of saving it", async () => {
    const svc = makeService({ claudeAvailable: false });
    await expect(svc.create("u1", "Bad segment", {
      include: { kind: "group", match: "all", conditions: [{ kind: "condition", differentiatorId: "nope", operator: "eq", value: 1 }] },
    })).rejects.toThrow();
  });
});
