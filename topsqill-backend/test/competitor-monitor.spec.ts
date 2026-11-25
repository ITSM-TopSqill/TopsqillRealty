import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
  process.env.META_APP_ID ??= "test-app-id";
  process.env.META_APP_SECRET ??= "test-app-secret";
});

const { searchAdLibrary } = vi.hoisted(() => ({ searchAdLibrary: vi.fn() }));
vi.mock("../src/competitive-intelligence/ad-library", async () => {
  const actual = await vi.importActual<typeof import("../src/competitive-intelligence/ad-library")>("../src/competitive-intelligence/ad-library");
  return { ...actual, searchAdLibrary };
});

import { monitorCompetitors } from "../worker/competitor-monitor";

function makePool(opts: { watches: { id: string; owner_id: string; search_terms: string }[]; seenByWatch?: Record<string, { fingerprint: string }[]> }) {
  const inserted: unknown[] = [];
  const notifications: unknown[] = [];
  const updated: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.includes("select id, owner_id, search_terms from competitor_watches")) return { rows: opts.watches };
      if (s.includes("select fingerprint from competitor_watch_ads")) return { rows: opts.seenByWatch?.[params[0] as string] ?? [] };
      if (s.includes("insert into competitor_watch_ads")) { inserted.push(params); return { rows: [] }; }
      if (s.includes("update competitor_watches set last_checked_at")) { updated.push(params[0] as string); return { rows: [] }; }
      if (s.includes("insert into notifications")) { notifications.push(params); return { rows: [] }; }
      return { rows: [] };
    }),
  };
  return { pool, inserted, notifications, updated };
}

describe("monitorCompetitors", () => {
  beforeEach(() => { searchAdLibrary.mockReset(); });

  it("baselines a brand-new watch without notifying - nothing was 'new' before the first check", async () => {
    searchAdLibrary.mockResolvedValue([
      { pageName: "Rival Realty", headline: "3 BHK ready", body: "Book a visit", platforms: [], firstSeenAt: null, lastSeenAt: null, stillRunning: true, daysObserved: null, snapshotUrl: null },
    ]);
    const { pool, inserted, notifications, updated } = makePool({ watches: [{ id: "w1", owner_id: "u1", search_terms: "realty gurgaon" }], seenByWatch: {} });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await monitorCompetitors(pool as any, undefined);
    expect(result.checked).toBe(1);
    expect(inserted).toHaveLength(1);        // baseline ad recorded
    expect(notifications).toHaveLength(0);   // but no notification on first check
    expect(updated).toContain("w1");
  });

  it("notifies only of ads not seen on a previous check", async () => {
    searchAdLibrary.mockResolvedValue([
      { pageName: "Rival Realty", headline: "3 BHK ready", body: "Book a visit", platforms: [], firstSeenAt: null, lastSeenAt: null, stillRunning: true, daysObserved: null, snapshotUrl: null },
      { pageName: "Rival Realty", headline: "4 BHK luxury", body: "New launch", platforms: [], firstSeenAt: null, lastSeenAt: null, stillRunning: true, daysObserved: null, snapshotUrl: null },
    ]);
    const existingFingerprint = "already-seen-fingerprint";
    const { pool, inserted, notifications } = makePool({
      watches: [{ id: "w1", owner_id: "u1", search_terms: "realty gurgaon" }],
      seenByWatch: { w1: [{ fingerprint: existingFingerprint }] },   // pretend the first ad was already seen (not a real fingerprint match, just non-empty = not first check)
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await monitorCompetitors(pool as any, undefined);
    expect(result.checked).toBe(1);
    expect(inserted.length).toBeGreaterThan(0);   // the genuinely new ad(s) get recorded
    expect(notifications).toHaveLength(1);        // and this time, since it's not the first check, a notification fires
  });

  it("skips a watch whose search fails, without blocking the rest of the batch", async () => {
    searchAdLibrary
      .mockRejectedValueOnce(new Error("transient Meta error"))
      .mockResolvedValueOnce([]);
    const { pool, updated } = makePool({
      watches: [{ id: "w1", owner_id: "u1", search_terms: "bad term" }, { id: "w2", owner_id: "u1", search_terms: "good term" }],
      seenByWatch: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await monitorCompetitors(pool as any, undefined);
    expect(result.checked).toBe(1);        // only the second watch succeeded
    expect(updated).toEqual(["w2"]);       // the failed one is NOT marked checked, so it's retried next run
  });
});
