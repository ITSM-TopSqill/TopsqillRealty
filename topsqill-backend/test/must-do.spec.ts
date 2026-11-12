import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "test-secret-at-least-16";
});

import { priceChange } from "../src/listings/listings.service";
import { profileStrength } from "../src/profiles/profiles.service";

describe("price drop badge", () => {
  it("shows on a cut and clears on a rise", () => {
    expect(priceChange(10_000_000, 9_500_000)).toBe("drop");
    expect(priceChange(9_500_000, 10_000_000)).toBe("rise");
    expect(priceChange(9_500_000, 9_500_000)).toBeNull();
    expect(priceChange(null, 9_500_000)).toBeNull();
  });
});

describe("profile strength", () => {
  const base = { type: "dealer", avatarMediaId: null, coverMediaId: null, headline: null, about: null, city: null, localities: [], specialties: [], kycVerified: false, reraVerified: false, listingCount: 0 } as never;
  it("starts low and says what to add first", () => {
    const s = profileStrength(base);
    expect(s.score).toBe(0);
    expect(s.next).toEqual(["Add a profile photo", "Write a headline", "Write a short About"]);
  });
  it("is 100 when everything is in place", () => {
    const s = profileStrength({ ...(base as object), avatarMediaId: "a", coverMediaId: "c", headline: "h", about: "x".repeat(80), city: "Noida",
      localities: ["Sector 50"], specialties: ["Resale"], kycVerified: true, reraVerified: true, listingCount: 3 } as never);
    expect(s).toEqual({ score: 100, next: [] });
  });
  it("doesn't ask buyers for RERA or listings", () => {
    const s = profileStrength({ ...(base as object), type: "buyer" } as never);
    expect(s.score).toBe(20);
    expect(s.next).not.toContain("Verify your RERA number");
  });
});
