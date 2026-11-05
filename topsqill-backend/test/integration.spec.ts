/**
 * Integration tests with the outside world stubbed.
 * Meta, Google, LinkedIn and WhatsApp are replaced by a fake fetch, so the whole
 * path (consent rules, 24-hour window, budget split, failure handling) is
 * exercised without touching a real account or spending money.
 */
import { describe, it, expect, beforeEach } from "vitest";

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let failNext: string | null = null;

function stubFetch() {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: u, body });
    if (failNext && u.includes(failNext)) {
      failNext = null;
      return new Response("rate limit", { status: 429 });
    }
    if (u.includes("/campaigns")) return Response.json({ id: "meta_c_1" });
    if (u.includes("campaignBudgets:mutate")) return Response.json({ results: [{ resourceName: "customers/1/campaignBudgets/9" }] });
    if (u.includes("adCampaigns")) return Response.json({ id: "li_c_1" });
    if (u.includes("/messages")) return Response.json({ messages: [{ id: "wamid.X1" }] });
    if (u.includes("/insights")) return Response.json({ data: [{ impressions: "12000", clicks: "340", spend: "8400", actions: [{ action_type: "lead", value: "26" }] }] });
    return Response.json({ ok: true });
  }) as typeof fetch;
}

/**
 * A small fake database. Each test queues the rows its queries should return,
 * in order, which keeps the test readable and avoids needing a real Postgres.
 */
function makeDb(results: unknown[][]) {
  const queue = [...results];
  const next = () => (queue.length ? queue.shift()! : []);
  // Lazy: a query only takes from the queue when it is actually awaited,
  // so intermediate builder steps (.where, .limit) do not consume results.
  const chain = (): any => ({
    where: () => chain(), orderBy: () => chain(), limit: () => chain(),
    innerJoin: () => chain(), groupBy: () => chain(),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(next()).then(resolve, reject),
  });
  return {
    select: () => ({ from: () => chain() }),
    execute: () => chain(),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "new", status: "connected" }],
        onConflictDoNothing: async () => [],
        onConflictDoUpdate: () => ({ returning: async () => [{ id: "new", status: "connected", phoneNumberId: "p1", displayNumber: "+919355135887" }] }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [{}] }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeDb([])),
  } as never;
}

describe("ad platform launch", () => {
  beforeEach(stubFetch);

  it("works out which platforms a plan needs and whether they are connected", async () => {
    const { AdPlatformsService } = await import("../src/integrations/ad-platforms.service");
    const channels = [
      { channel: "Instagram and Facebook", budgetPct: 45 },
      { channel: "Google Search", budgetPct: 30 },
      { channel: "YouTube", budgetPct: 10 },
      { channel: "LinkedIn", budgetPct: 15 },
    ];
    // Only the Meta account is connected.
    const db = makeDb([[{ id: "a1", ownerId: "u1", platform: "meta", accountId: "123", secretRef: "s", status: "connected" }]]);
    const svc = new AdPlatformsService(db, db, { get: async () => "token", put: async () => "ref", remove: async () => {} } as never);
    const readiness = await svc.readiness("u1", channels as never);
    // Google Search and YouTube are both Google Ads, so three platforms, not four.
    expect(readiness.platforms.map((p) => p.platform).sort()).toEqual(["google", "linkedin", "meta"]);
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.sort()).toEqual(["google", "linkedin"]);
  });

  it("creates one campaign per platform and keeps going when one fails", async () => {
    const { AdPlatformsService } = await import("../src/integrations/ad-platforms.service");
    const plan = { channels: [{ channel: "Instagram and Facebook", budgetPct: 60 }, { channel: "Google Search", budgetPct: 40 }] };
    const campaign = { id: "c1", ownerId: "u1", name: "Sector 150 campaign", budgetInr: 100000, days: 10, plan };
    const accounts = [
      { id: "a1", ownerId: "u1", platform: "meta", accountId: "123", secretRef: "s1", status: "connected" },
      { id: "a2", ownerId: "u1", platform: "google", accountId: "456", secretRef: "s2", status: "connected" },
    ];
    const db = makeDb([
      [campaign],        // load the campaign
      accounts,          // readiness check
      [accounts[0]],     // meta account
      [accounts[1]],     // google account
    ]);
    const svc = new AdPlatformsService(db, db, { get: async () => "token", put: async () => "ref", remove: async () => {} } as never);
    failNext = "googleads";                                  // Google rejects this one
    const res = await svc.launch("u1", "c1");
    expect(res.launched).toBe(true);                         // Meta still went live
    const meta = res.deliveries!.find((d) => d.platform === "meta")!;
    const google = res.deliveries!.find((d) => d.platform === "google")!;
    expect(meta.status).toBe("live");
    expect(meta.budgetInr).toBe(60000);                      // 60% of the budget
    expect(google.status).toBe("failed");
    expect(google.budgetInr).toBe(40000);
    // Meta requires property ads to declare the housing category.
    const metaCall = calls.find((c) => c.url.includes("graph.facebook.com"))!;
    expect(metaCall.body.special_ad_categories).toEqual(["HOUSING"]);
    expect(metaCall.body.status).toBe("PAUSED");             // never starts spending on its own
  });

  it("refuses to launch when an account is missing, instead of silently doing nothing", async () => {
    const { AdPlatformsService } = await import("../src/integrations/ad-platforms.service");
    const plan = { channels: [{ channel: "Instagram and Facebook", budgetPct: 100 }] };
    const campaign = { id: "c1", ownerId: "u1", name: "Test", budgetInr: 50000, days: 10, plan };
    const db = makeDb([[campaign], []]);                     // campaign found, no ad accounts
    const svc = new AdPlatformsService(db, db, { get: async () => null, put: async () => "r", remove: async () => {} } as never);
    const res = await svc.launch("u1", "c1");
    expect(res.launched).toBe(false);
    expect(res.message).toContain("Connect your meta");
    expect(calls.length).toBe(0);                            // nothing was sent to Meta
  });
});

describe("whatsapp sending rules", () => {
  beforeEach(stubFetch);

  const account = { id: "w1", ownerId: "u1", wabaId: "w", phoneNumberId: "p1", secretRef: "s", status: "connected" };
  /** Queues: account lookup, opt-in lookup, last inbound message. */
  const build = (opts: { optIn: boolean; inbound?: Date }) => makeDb([
    [account],
    opts.optIn ? [{ ownerId: "u1", phone: "+919876543210", optedOutAt: null }] : [],
    opts.inbound ? [{ createdAt: opts.inbound }] : [],
  ]);

  it("will not message someone who has not opted in", async () => {
    const { WhatsAppService } = await import("../src/integrations/whatsapp.service");
    const db = build({ optIn: false });
    const svc = new WhatsAppService(db, db, { get: async () => "t" } as never, { addActivity: async () => {}, capture: async () => ({}) } as never);
    await expect(svc.send("u1", { to: "9876543210", body: "hi" })).rejects.toThrow(/opted in|opted out/i);
    expect(calls.length).toBe(0);
  });

  it("allows free text inside the 24-hour window", async () => {
    const { WhatsAppService } = await import("../src/integrations/whatsapp.service");
    const db = build({ optIn: true, inbound: new Date(Date.now() - 2 * 3600_000) });
    const svc = new WhatsAppService(db, db, { get: async () => "t" } as never, { addActivity: async () => {}, capture: async () => ({}) } as never);
    const res = await svc.send("u1", { to: "9876543210", body: "Sharing the floor plan" });
    expect(res.status).toBe("sent");
    expect(calls[0].body.type).toBe("text");
  });

  it("requires a template once the window has closed", async () => {
    const { WhatsAppService } = await import("../src/integrations/whatsapp.service");
    const db = build({ optIn: true, inbound: new Date(Date.now() - 30 * 3600_000) });
    const svc = new WhatsAppService(db, db, { get: async () => "t" } as never, { addActivity: async () => {}, capture: async () => ({}) } as never);
    await expect(svc.send("u1", { to: "9876543210", body: "hi" })).rejects.toThrow(/24 hours/);
    const db2 = build({ optIn: true, inbound: new Date(Date.now() - 30 * 3600_000) });
    const svc2 = new WhatsAppService(db2, db2, { get: async () => "t" } as never, { addActivity: async () => {}, capture: async () => ({}) } as never);
    const res = await svc2.send("u1", { to: "9876543210", template: "site_visit_reminder", templateParams: ["Riya"] });
    expect(res.status).toBe("sent");
    expect(calls.at(-1)!.body.type).toBe("template");
  });

  it("normalises Indian numbers before sending", async () => {
    const { WhatsAppService } = await import("../src/integrations/whatsapp.service");
    const db = build({ optIn: true, inbound: new Date() });
    const svc = new WhatsAppService(db, db, { get: async () => "t" } as never, { addActivity: async () => {}, capture: async () => ({}) } as never);
    await svc.send("u1", { to: "098765 43210", body: "hi" });
    expect(calls[0].body.to).toBe("919876543210");
  });
});
