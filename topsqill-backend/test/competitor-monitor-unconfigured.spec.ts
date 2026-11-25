import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "x".repeat(40);
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

import { monitorCompetitors } from "../worker/competitor-monitor";

describe("monitorCompetitors without Meta configured", () => {
  it("checks nothing and says why, rather than pretending the pool has no watches", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "w1", owner_id: "u1", search_terms: "realty" }] }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await monitorCompetitors(pool as any, undefined);
    expect(result.checked).toBe(0);
    expect(result.reason).toMatch(/isn't configured/i);
    expect(pool.query).not.toHaveBeenCalled();   // never even queries for due watches - fails fast and honestly
  });
});
