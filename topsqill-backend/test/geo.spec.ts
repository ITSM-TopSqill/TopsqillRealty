import { describe, expect, it } from "vitest";
import { placeFrom } from "../src/geo/geo.service";

describe("location picker", () => {
  it("turns an OpenStreetMap result into a short label, locality and city", () => {
    const p = placeFrom({ display_name: "DLF The Crest, Sector 54, Gurugram, Haryana, 122011, India", lat: "28.4405", lon: "77.1007",
      address: { suburb: "Sector 54", city: "Gurugram", state: "Haryana" } });
    expect(p).toEqual({ label: "DLF The Crest, Sector 54, Gurugram", lat: 28.4405, lng: 77.1007, locality: "Sector 54", city: "Gurgaon" });
  });
  it("copes with sparse addresses", () => {
    const p = placeFrom({ lat: "18.5", lon: "73.8", name: "Baner", address: { town: "Baner" } });
    expect(p.label).toBe("Baner");
    expect(p.locality).toBe("Baner");
  });
});
