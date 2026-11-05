import { describe, it, expect } from "vitest";
import { normalisePhone, makeOtp } from "../src/auth/phone";
import { encodeCursor, decodeCursor, newId } from "../src/common/ids";
import { loadEnv } from "../src/common/env";

describe("phone numbers", () => {
  it("accepts the ways Indians type their number", () => {
    for (const raw of ["9355135887", "+91 93551 35887", "093551-35887", "0091 9355135887", "+919355135887"]) {
      expect(normalisePhone(raw)).toBe("+919355135887");
    }
  });
  it("rejects invalid numbers", () => {
    for (const raw of ["12345", "1234567890", "", "abcd"]) expect(normalisePhone(raw)).toBeNull();
  });
  it("keeps NRI numbers", () => {
    expect(normalisePhone("+971501234567")).toBe("+971501234567");
  });
});

describe("one-time codes", () => {
  it("is always 6 digits and never starts with 0", () => {
    for (let i = 0; i < 500; i++) {
      const code = makeOtp();
      expect(code).toMatch(/^[1-9]\d{5}$/);
    }
  });
});

describe("pagination cursors", () => {
  it("survives a round trip", () => {
    const t = new Date("2026-10-28T10:00:00.000Z");
    const id = newId();
    const back = decodeCursor(encodeCursor(t, id))!;
    expect(back.t).toBe(t.toISOString());
    expect(back.id).toBe(id);
  });
  it("ignores rubbish instead of crashing", () => {
    for (const bad of ["", "not-a-cursor", "!!!", undefined]) expect(decodeCursor(bad as any)).toBeNull();
  });
});

describe("ids", () => {
  it("are time-ordered so new rows stay together in the index", () => {
    const a = newId();
    const b = newId();
    expect(a < b || a === b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => newId())).size).toBe(1000);
  });
});

describe("configuration", () => {
  it("refuses to start with a weak JWT secret", () => {
    expect(() => loadEnv({ DATABASE_URL: "postgres://x", JWT_SECRET: "short" } as any)).toThrow(/JWT_SECRET/);
  });
  it("accepts a valid configuration", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://x", JWT_SECRET: "a-long-enough-secret-value" } as any);
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("development");
  });
});

import { matchScore, MATCH_THRESHOLD } from "../src/requirements/matching";

const listing = (over: Record<string, unknown> = {}) => ({
  city: "Noida", locality: "Sector 150", purpose: "sale", kind: "Apartment",
  bhk: 3, priceInr: 15_000_000, areaSqft: 1650, possession: "Ready to move", ...over,
}) as never;
const req = (over: Record<string, unknown> = {}) => ({
  city: "Noida", localities: ["Sector 150", "Sector 137"], purpose: "sale", kind: "Apartment",
  bhk: 3, minPrice: 12_000_000, maxPrice: 16_000_000, minArea: 1500, timeline: "in 2–3 months", ...over,
}) as never;

describe("requirement matching", () => {
  it("scores a perfect fit highly", () => {
    expect(matchScore(listing(), req())).toBeGreaterThanOrEqual(95);
  });
  it("rejects a different city or purpose outright", () => {
    expect(matchScore(listing({ city: "Gurgaon" }), req())).toBe(0);
    expect(matchScore(listing({ purpose: "rent" }), req())).toBe(0);
  });
  it("still matches a nearby locality, but lower", () => {
    const near = matchScore(listing({ locality: "Sector 128" }), req());
    expect(near).toBeLessThan(matchScore(listing(), req()));
    expect(near).toBeGreaterThan(0);
  });
  it("drops listings well over budget below the threshold", () => {
    expect(matchScore(listing({ priceInr: 40_000_000 }), req())).toBeLessThan(MATCH_THRESHOLD);
  });
  it("allows a small stretch over budget", () => {
    expect(matchScore(listing({ priceInr: 16_800_000 }), req())).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
  it("never returns more than 99 or less than 0", () => {
    for (const p of [1, 1e9]) {
      const s = matchScore(listing({ priceInr: p }), req());
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(99);
    }
  });
});

import { scoreLead } from "../src/leads/scoring";
import { parseBudget } from "../src/leads/parse";

describe("lead scoring", () => {
  it("ranks a verified, ready buyer with matching budget highly", () => {
    const r = scoreLead({ name: "Riya Sharma", phone: "9355135887", otpVerified: true,
      budgetMax: 16_000_000, listingPrice: 15_000_000, timeline: "immediately", locality: "Sector 150", source: "google" });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.qualified).toBe(true);
  });
  it("marks a lead without a phone number as not qualified", () => {
    const r = scoreLead({ name: "Anon", timeline: "immediately", budgetMax: 20_000_000, listingPrice: 15_000_000 });
    expect(r.qualified).toBe(false);
    expect(r.reason).toContain("no valid phone");
  });
  it("pushes window shoppers down", () => {
    const low = scoreLead({ name: "A B", phone: "9876543210", timeline: "just looking", budgetMax: 5_000_000, listingPrice: 20_000_000 });
    const high = scoreLead({ name: "A B", phone: "9876543210", timeline: "immediately", budgetMax: 20_000_000, listingPrice: 20_000_000 });
    expect(low.score).toBeLessThan(high.score);
    expect(low.qualified).toBe(false);
  });
  it("always returns 0 to 100", () => {
    for (const t of ["immediately", "next year", ""]) {
      const r = scoreLead({ phone: "9876543210", timeline: t });
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("budget parsing", () => {
  it("understands how Indians write budgets", () => {
    expect(parseBudget("1.5 Cr")).toBe(15000000);
    expect(parseBudget("80 lakh")).toBe(8000000);
    expect(parseBudget("₹95,00,000")).toBe(9500000);
    expect(parseBudget("45k")).toBe(45000);
    expect(parseBudget(2500000)).toBe(2500000);
    expect(parseBudget(undefined)).toBeUndefined();
  });
});

import { extractProject, estimatePrices } from "../src/ai/extract";
import { buildPlan, forecast, segmentOf } from "../src/campaigns/planner";
import { pincodesFor } from "../src/campaigns/pincodes";

const HERO = `Leafsong Retreat Hero Homes Sector MU Greater Noida
3BHK 153.84 sq. mtr to 212.68 sq. mtr. Three 30-storey towers above three basement levels.
Amenities: Restaurant, Gym, Biophilic Lounge, Banquet Hall, Meditation Centre, Spa and Salon, Indoor And Outdoor Kids Play Zone, Library
- Fortis Hospital: 5.1 Km
- Scholars Home International School: 4.0 Km
- MSX Mall: 4.4 Km
UP RERA Reg. No.: UPRERAPRJ414014/10/2026 Launch Date: 09.10.2026`;

describe("project extraction", () => {
  const p = extractProject("https://www.herohomes.in/projects/apartments/greater-noida-uttar-pradesh/leafsong-retreat-sec-mu", HERO);

  it("reads the project name from the link", () => expect(p.name).toBe("Leafsong Retreat"));
  it("finds the city and locality", () => {
    expect(p.city).toBe("Greater Noida");
    expect(p.locality.toLowerCase()).toContain("sector mu");
  });
  it("keeps the full RERA number", () => expect(p.reraNumber).toBe("UPRERAPRJ414014/10/2026"));
  it("converts square metres to square feet", () => {
    const c = p.configs.find((x) => x.bhk === 3)!;
    expect(c.sbua).toBe(1656);          // 153.84 sq m
    expect(c.sbuaMax).toBe(2289);       // 212.68 sq m
  });
  it("reads towers written as words and storeys", () => {
    expect(p.towers).toBe(3);
    expect(p.floors).toBe(30);
  });
  it("picks amenities but not the places in the distance list", () => {
    expect(p.amenities).toContain("Gym");
    expect(p.amenities).toContain("Banquet hall");
    expect(p.amenities.join(" ")).not.toContain("Hospital");
  });
  it("reads the nearby places with the right icons", () => {
    const hospital = p.nearby.find((n) => /Fortis/.test(n.name))!;
    expect(hospital.km).toBe(5.1);
    expect(hospital.icon).toBe("🏥");
    expect(p.nearby.find((n) => /School/.test(n.name))?.icon).toBe("🏫");
  });
  it("marks prices as estimated when the builder publishes none", () => {
    expect(p.priceEstimated).toBe(true);
    const withPrices = estimatePrices(p.configs, 7669);
    expect(withPrices[0].price).toBeGreaterThan(0);
    expect(withPrices[0].estimated).toBe(true);
  });
  it("does not invent a city from an unrelated link", () => {
    const blank = extractProject("https://example.com/", "");
    expect(blank.configs.length).toBe(0);
    expect(blank.priceEstimated).toBe(true);
  });
});

describe("campaign planning", () => {
  const demand = { buyersHere: 12, topLocalities: [{ locality: "Sector 137", buyers: 9 }], avgRate: 11000 };
  const base = { purpose: "sale", bhk: 3, kind: "Apartment", city: "Noida", locality: "Sector 150",
    possession: "Ready to move", amenities: ["Clubhouse"], goal: "Qualified buyers", demand, pincodesFor };

  it("targets HNI and NRI buyers for premium homes", () => {
    const plan = buildPlan({ ...base, priceInr: 40_000_000 } as never);
    expect(plan.personas.map((p) => p.name).join()).toContain("HNI");
    expect(plan.channels.some((c) => c.channel === "LinkedIn")).toBe(true);
  });
  it("targets first-time buyers for affordable homes", () => {
    const plan = buildPlan({ ...base, priceInr: 4_500_000 } as never);
    expect(plan.personas.map((p) => p.name).join()).toContain("First-time");
  });
  it("includes the property's own pincode and nearby demand", () => {
    const plan = buildPlan({ ...base, priceInr: 15_000_000 } as never);
    expect(plan.pincodes.some((p) => p.pin === "201310" && p.tier === "Core")).toBe(true);
    expect(plan.pincodes.some((p) => p.tier === "Demand")).toBe(true);
  });
  it("splits the budget to exactly 100%", () => {
    for (const price of [4_500_000, 15_000_000, 40_000_000]) {
      const plan = buildPlan({ ...base, priceInr: price } as never);
      expect(plan.channels.reduce((a, c) => a + c.budgetPct, 0)).toBe(100);
    }
  });
  it("forecasts fewer but better leads for premium homes", () => {
    const cheap = forecast(buildPlan({ ...base, priceInr: 4_500_000 } as never), 100_000, segmentOf("sale", 4_500_000));
    const lux = forecast(buildPlan({ ...base, priceInr: 40_000_000 } as never), 100_000, segmentOf("sale", 40_000_000));
    expect(cheap.leads).toBeGreaterThan(lux.leads);
    expect(lux.costPerLead).toBeGreaterThan(cheap.costPerLead);
    expect(lux.qualified).toBeLessThanOrEqual(lux.leads);
  });
  it("always requires RERA disclosure on sale campaigns", () => {
    const plan = buildPlan({ ...base, priceInr: 15_000_000 } as never);
    expect(plan.compliance.join(" ")).toContain("RERA");
    expect(plan.compliance.join(" ")).toContain("No guaranteed-returns");
  });
});

describe("pincode lookup", () => {
  it("matches however the locality is capitalised or spaced", () => {
    for (const v of ["Sector Mu", "Sector MU", "sector mu", "  Sector  Mu "]) {
      expect(pincodesFor(v)).toContain("201310");
    }
    expect(pincodesFor("Nowhere")).toEqual([]);
  });
});

import { isUniqueViolation } from "../src/jobs/jobs.service";

describe("database error handling", () => {
  it("recognises a unique violation however deeply it is wrapped", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("duplicate key value violates unique constraint"))).toBe(true);
    const wrapped = new Error("Failed query: insert into job_applications");
    (wrapped as Error & { cause?: unknown }).cause = { code: "23505" };
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
