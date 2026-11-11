import { describe, expect, it } from "vitest";
import { scrubList, scrubSources, PORTAL_HOST } from "../src/common/sources";
import { scrubDraft } from "../src/ai/listing-import.service";

describe("keeping other sites' names out of imports", () => {
  it("removes portal names, phrases and links", () => {
    expect(scrubSources("Spacious 3 BHK posted on 99acres in Sector 49")).toBe("Spacious 3 BHK in Sector 49");
    expect(scrubSources("Ready flat. Listed on MagicBricks. Call now")).toBe("Ready flat. Call now");
    expect(scrubSources("See https://www.99acres.com/x-spid-N1 for more")).toBe("See for more");
    expect(scrubSources("NoBroker verified, owner listing")).toBe("owner listing");
    expect(scrubSources("Park facing (Housing.com)")).toBe("Park facing");
    expect(scrubSources("99acres ID: A12345678 Corner flat")).toBe("Corner flat");
    expect(scrubSources("Close to Magic Bricks road")).toBe("Close to road");
  });
  it("leaves normal words alone", () => {
    expect(scrubSources("Affordable housing near metro, 2 acres of greens")).toBe("Affordable housing near metro, 2 acres of greens");
    expect(scrubSources("Gated society with clubhouse")).toBe("Gated society with clubhouse");
  });
  it("drops list items that were only a site name", () => {
    expect(scrubList(["Gym", "99acres", "Pool"])).toEqual(["Gym", "Pool"]);
  });
  it("cleans every published field of a draft", () => {
    const d = scrubDraft({ title: "3 BHK on 99acres", description: "Nice home. Posted on MagicBricks.", projectName: "", builder: "", locality: "Sector 49",
      facing: "", possession: "", furnishing: "", amenities: ["Lift"], usps: ["99acres verified"], configs: [], images: [{ url: "u", alt: "99acres photo" }] } as never);
    expect(d.title).toBe("3 BHK");
    expect(d.description).toBe("Nice home.");
    expect(d.usps).toEqual([]);
    expect(d.images[0].alt).toBe("photo");
  });
  it("knows portal hosts", () => {
    expect(PORTAL_HOST.test("www.99acres.com")).toBe(true);
    expect(PORTAL_HOST.test("housing.com")).toBe(true);
    expect(PORTAL_HOST.test("herohomesproperties.in")).toBe(false);
  });
});
