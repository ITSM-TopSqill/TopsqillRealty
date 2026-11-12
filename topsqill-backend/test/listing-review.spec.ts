import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "test-secret-at-least-16";
});

import { reviewChecks, REVIEW_REASONS } from "../src/listings/review.service";

const base = { title: "3 BHK in Sector 54", description: "A bright, well-kept 3 BHK on a high floor with a park view and covered parking.", priceInr: 21_000_000, areaSqft: 1650, bhk: 3, purpose: "sale", possession: "Ready to move", reraNumber: null, kind: "Apartment" };
const good = { photos: 6, medianRate: 13_000, duplicates: 0, kycVerified: true, reraVerified: true, ownerType: "dealer", accountDays: 200, submittedToday: 1 };

describe("listing review checks", () => {
  it("passes a complete listing from a verified dealer at a normal price", () => {
    const r = reviewChecks(base, good);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.risk).toBe("low");
  });
  it("flags contact details, odd prices, duplicates and new accounts", () => {
    const r = reviewChecks({ ...base, description: "Call 98100 12345 now! www.example.com", priceInr: 2_000_000 },
      { ...good, photos: 0, duplicates: 2, kycVerified: false, accountDays: 0, submittedToday: 14 });
    const bad = r.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(bad).toEqual(expect.arrayContaining(["photos", "price", "contact", "duplicate", "owner", "volume"]));
    expect(r.risk).toBe("high");
  });
  it("wants a RERA number only for under-construction homes for sale", () => {
    expect(reviewChecks({ ...base, possession: "Under construction" }, good).checks.find((c) => c.id === "rera")!.ok).toBe(false);
    expect(reviewChecks({ ...base, possession: "Under construction", reraNumber: "UPRERAPRJ123456" }, good).checks.find((c) => c.id === "rera")!.ok).toBe(true);
  });
  it("has owner-friendly reasons", () => {
    expect(Object.keys(REVIEW_REASONS)).toContain("photos");
    expect(REVIEW_REASONS.contact).toMatch(/phone numbers/);
  });
});
