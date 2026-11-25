import { describe, it, expect, vi, afterEach } from "vitest";
import { mapAd, searchAdLibrary, AdLibraryNotConfiguredError, AdLibraryError } from "../src/competitive-intelligence/ad-library";

describe("mapAd", () => {
  it("marks an ad with no stop time as still running, and computes real observed days", () => {
    const now = new Date("2026-01-20T00:00:00Z").getTime();
    const r = mapAd({ page_name: "Acme Realty", ad_creative_link_titles: ["3 BHK ready to move"], ad_creative_bodies: ["Book a site visit today"], ad_delivery_start_time: "2026-01-10T00:00:00Z" }, now);
    expect(r.stillRunning).toBe(true);
    expect(r.daysObserved).toBe(10);
    expect(r.pageName).toBe("Acme Realty");
    expect(r.headline).toBe("3 BHK ready to move");
  });

  it("marks an ad with a stop time as not running", () => {
    const r = mapAd({ page_name: "Acme Realty", ad_delivery_start_time: "2026-01-01T00:00:00Z", ad_delivery_stop_time: "2026-01-05T00:00:00Z" });
    expect(r.stillRunning).toBe(false);
    expect(r.daysObserved).toBe(4);
  });

  it("never fabricates a performance field - the mapped shape has none", () => {
    const r = mapAd({ page_name: "Acme Realty" });
    expect(r).not.toHaveProperty("ctr");
    expect(r).not.toHaveProperty("roas");
    expect(r).not.toHaveProperty("conversions");
    expect(r.daysObserved).toBeNull();
  });

  it("handles a completely empty record without throwing", () => {
    expect(() => mapAd({})).not.toThrow();
    expect(mapAd({}).pageName).toBe("Unknown advertiser");
  });
});

describe("searchAdLibrary", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("refuses to run without real META_APP_ID/META_APP_SECRET, rather than returning fabricated results", async () => {
    await expect(searchAdLibrary({ apiVersion: "v21.0", searchTerms: "realty", countries: ["IN"], limit: 10 })).rejects.toThrow(AdLibraryNotConfiguredError);
  });

  it("requires a real search term", async () => {
    await expect(searchAdLibrary({ appId: "a", appSecret: "b", apiVersion: "v21.0", searchTerms: "  ", countries: ["IN"], limit: 10 })).rejects.toThrow(AdLibraryError);
  });

  it("maps a successful real response into the honest result shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ page_name: "Rival Realty", ad_creative_bodies: ["Luxury homes in Gurgaon"] }] }),
    }));
    const results = await searchAdLibrary({ appId: "a", appSecret: "b", apiVersion: "v21.0", searchTerms: "realty gurgaon", countries: ["IN"], limit: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].pageName).toBe("Rival Realty");
  });

  it("surfaces Meta's real error message rather than swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { message: "Invalid parameter", error_user_msg: "ad_reached_countries is required" } }),
    }));
    await expect(searchAdLibrary({ appId: "a", appSecret: "b", apiVersion: "v21.0", searchTerms: "realty", countries: ["IN"], limit: 10 }))
      .rejects.toThrow(/ad_reached_countries is required/);
  });
});
