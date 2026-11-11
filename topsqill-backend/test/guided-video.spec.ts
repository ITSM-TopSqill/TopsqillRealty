import { describe, expect, it } from "vitest";
import { rulesScript } from "../src/ai/guided-video.service";

describe("guided video script", () => {
  const l = { id: "l1", title: "3 BHK in Sector 49", purpose: "sale", kind: "Apartment", bhk: 3, areaSqft: 1650, priceInr: 18_200_000,
    city: "Noida", locality: "Sector 49", possession: "Ready to move", furnishing: "Semi-furnished", facing: "East facing",
    amenities: ["Gym", "Pool"], usps: ["Posted on 99acres", "Near metro"], media: [{ kind: "image", label: "Kitchen" }, { kind: "image", label: null }] };
  it("is written from the facts, with a line for every scene", () => {
    const s = rulesScript(l);
    expect(s.intro).toContain("3 BHK apartment in Sector 49, Noida");
    expect(s.intro).toContain("1,650 square feet");
    expect(s.photos).toHaveLength(2);
    expect(s.photos[0]).toBe("Here is the kitchen.");
    expect(Object.values(s.rooms).every(Boolean)).toBe(true);
    expect(s.outro).toMatch(/Topsqill/);
  });
  it("never names another site", () => {
    expect(JSON.stringify(rulesScript(l))).not.toMatch(/99acres/i);
  });
});
