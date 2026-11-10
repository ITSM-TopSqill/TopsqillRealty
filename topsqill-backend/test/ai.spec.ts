import { describe, it, expect } from "vitest";
import { parseQuery, intentOf, emi, money } from "../src/ai/query";
import { needsLabel } from "../worker/photo-tags";

describe("assistant query reader (used when AI is off)", () => {
  it("reads bedrooms, budget, city and place", () => {
    expect(parseQuery("3 bhk in sector 65 gurgaon under 2.5 cr")).toMatchObject({ bhk: 3, maxPrice: 25_000_000, city: "Gurgaon", rest: "sector 65" });
    expect(parseQuery("2BHK rent Powai below 60k")).toMatchObject({ bhk: 2, maxPrice: 60_000, purpose: "rent", rest: "Powai" });
    expect(parseQuery("villa in Sohna Road between 2 cr and 4 cr")).toMatchObject({ kind: "Villa", minPrice: 20_000_000, maxPrice: 40_000_000 });
    expect(parseQuery("1800 sq ft on golf course road").areaSqft).toBe(1800);
  });
  it("understands Indian money units", () => {
    expect(money("80", "lakh")).toBe(8_000_000);
    expect(money("1.25", "cr")).toBe(12_500_000);
    expect(money("45", "k")).toBe(45_000);
  });
  it("tells what kind of question it is", () => {
    expect(intentOf("what is the price per sq ft in sector 82")).toBe("price");
    expect(intentOf("top dealers in noida")).toBe("people");
    expect(intentOf("show my leads")).toBe("leads");
    expect(intentOf("write a post about my new listing")).toBe("write");
    expect(intentOf("sales manager jobs")).toBe("jobs");
    expect(intentOf("3 bhk in powai")).toBe("listings");
  });
  it("works out a home loan EMI", () => {
    // 1 Cr at 8.5% for 20 years is about ₹86,782 a month.
    expect(emi(10_000_000)).toBeGreaterThan(86_000);
    expect(emi(10_000_000)).toBeLessThan(87_500);
  });
});

describe("photo tagging", () => {
  it("replaces file names but keeps labels people typed", () => {
    expect(needsLabel(null)).toBe(true);
    expect(needsLabel("IMG_2034.jpg")).toBe(true);
    expect(needsLabel("WhatsApp Image 2026-11-02 at 10.31.22")).toBe(true);
    expect(needsLabel("Master bedroom with balcony")).toBe(false);
    expect(needsLabel("Kitchen")).toBe(false);
  });
});
