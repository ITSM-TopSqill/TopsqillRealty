import { describe, it, expect, vi } from "vitest";
// The services below read settings when loaded.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "test-secret-at-least-16";
  process.env.REDIS_URL ??= "redis://127.0.0.1:1";
  process.env.BRIGHTDATA_API_KEY = "test-brightdata-key";
  process.env.BRIGHTDATA_ZONE = "topsqill_unlocker";
  process.env.APISH_API_KEY = "ash_test_key";
});
import { isPrivateAddress, checkUrl, cleanUrl, safeFetch } from "../src/common/safe-fetch";
import { videoEmbed, tourEmbed } from "../src/common/embeds";
import { readPage, coordsOf } from "../src/ai/page-reader";
import { sniffImage } from "../src/media/media.service";
import { ListingImportService, homeCards, pickCity } from "../src/ai/listing-import.service";
import { cleanLinks } from "../src/listings/listings.service";
import { unlock, PageFetcher } from "../src/ai/page-fetcher.service";
import { apishEndpointFor, pageFromApish, portalFacts, readViaApish } from "../src/ai/apish";
import { KeyPool, parseKeys } from "../src/common/key-pool";

describe("safe fetching of pasted links", () => {
  it("refuses private, loopback and cloud-metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "142.250.183.14", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("accepts only plain public web links", () => {
    expect(() => checkUrl("file:///etc/passwd")).toThrow();
    expect(() => checkUrl("http://localhost:8080/admin")).toThrow();
    expect(() => checkUrl("http://169.254.169.254/computeMetadata/v1/")).toThrow();
    expect(() => checkUrl("http://metadata.google.internal/")).toThrow();
    expect(() => checkUrl("https://user:pass@example.com/")).toThrow();
    expect(() => checkUrl("https://example.com:6379/")).toThrow();
    expect(checkUrl("https://herohomesproperties.in/").hostname).toBe("herohomesproperties.in");
  });
  it("blocks a public name that resolves to a private address, at connect time", async () => {
    // localtest.me and its subdomains resolve to 127.0.0.1.
    await expect(safeFetch("http://localtest.me/", { timeoutMs: 4000 })).rejects.toThrow(/private address|couldn’t be found|reached/);
  });
  it("drops ad-tracking parameters", () => {
    expect(cleanUrl("https://herohomesproperties.in/?gad_source=1&gad_campaignid=24&gbraid=0AA&gclid=Cj0&utm_source=g#top"))
      .toBe("https://herohomesproperties.in/");
    expect(cleanUrl("https://site.in/p?id=42&utm_medium=cpc")).toBe("https://site.in/p?id=42");
  });
});

describe("video and 3D tour links", () => {
  it("accepts YouTube and Vimeo in their standard form only", () => {
    expect(videoEmbed("https://youtu.be/dQw4w9WgXcQ")?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(videoEmbed("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.embed).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(videoEmbed("https://vimeo.com/123456789")?.embed).toBe("https://player.vimeo.com/video/123456789");
    expect(videoEmbed("https://evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbed("javascript:alert(1)")).toBeNull();
  });
  it("accepts known 3D tour hosts", () => {
    expect(tourEmbed("https://my.matterport.com/show/?m=SxQL3iGyoDo")?.provider).toBe("matterport");
    expect(tourEmbed("https://kuula.co/share/collection/7lVxL?logo=1")?.url).toBe("https://kuula.co/share/collection/7lVxL");
    expect(tourEmbed("https://my.matterport.com.evil.io/show/?m=SxQL3iGyoDo")).toBeNull();
  });
  it("cleans links on save, and refuses others", () => {
    expect(cleanLinks({ videoUrl: "youtu.be/dQw4w9WgXcQ" }).videoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(cleanLinks({ videoUrl: "" }).videoUrl).toBeNull();
    expect(() => cleanLinks({ tourUrl: "https://phish.example/tour" })).toThrow();
    expect(cleanLinks({ lat: 28.4 })).toMatchObject({ lat: null, lng: null });
  });
});

const PAGE = `<!doctype html><html><head>
<title>Sky Gardens | Sector 150 Noida</title>
<meta property="og:image" content="/media/hero.jpg">
<script type="application/ld+json">{"@type":"Residence","geo":{"latitude":28.4089,"longitude":77.4957}}</script>
<style>.x{background-image:url('/media/bg.webp')}</style>
</head><body>
<img src="/img/logo.png" alt="logo"><img data-src="/img/tower.webp" alt="Tower view">
<img srcset="/img/pool-480.jpg 480w, /img/pool-1600.jpg 1600w" alt="Pool">
<a href="/gallery/kitchen-big.jpg">Kitchen</a>
<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
<a href="https://my.matterport.com/show/?m=SxQL3iGyoDo">Take the 3D tour</a>
<h1>Sky Gardens</h1><p>3 BHK &amp; 4 BHK homes. Starting from &#8377;1.65 Cr</p>
<script>var secret = "not text";</script>
</body></html>`;

describe("reading a property page", () => {
  const p = readPage(PAGE, "https://builder.example/projects/sky");
  it("finds photos, skipping logos and keeping the largest size", () => {
    const urls = p.images.map((i) => i.url);
    expect(urls[0]).toBe("https://builder.example/media/hero.jpg");
    expect(urls).toContain("https://builder.example/img/tower.webp");
    expect(urls).toContain("https://builder.example/img/pool-1600.jpg");
    expect(urls).toContain("https://builder.example/gallery/kitchen-big.jpg");
    expect(urls.some((u) => u.includes("logo"))).toBe(false);
  });
  it("finds the video, the 3D tour and the map pin", () => {
    expect(p.videos).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
    expect(p.tours).toEqual(["https://my.matterport.com/show/?m=SxQL3iGyoDo"]);
    expect([p.lat, p.lng]).toEqual([28.4089, 77.4957]);
  });
  it("keeps visible text only", () => {
    expect(p.text).toContain("3 BHK & 4 BHK homes. Starting from ₹1.65 Cr");
    expect(p.text).not.toContain("secret");
  });
  it("reads a Google Maps embed", () => {
    expect(coordsOf('<iframe src="https://www.google.com/maps/embed?pb=!1m18!2d77.55971507549508!3d28.475290975750923!2m3"></iframe>'))
      .toEqual({ lat: 28.475291, lng: 77.559715 });
    expect(coordsOf("@51.5,-0.12 maps")).toEqual({ lat: null, lng: null });   // outside India
  });
});

describe("drafting a listing from a page", () => {
  const svc = new ListingImportService({} as never, {} as never, {} as never);
  const text = "Leafsong Retreat by Hero Homes Greater Noida Sector MU. Premium 3 BHK residences Starting from ₹1.8 Cr*. 4.5 Acres. 3 Towers. 3 BHK + 2T Size 1,650 Sq. Ft. Swimming Pool, Clubhouse, Gym.";
  const page = { ...readPage("<title>Hero Homes DMIC Greater Noida</title>", "https://herohomesproperties.in/"), text };
  const rules = svc.rules("https://herohomesproperties.in/", page, text);
  it("works without AI", () => {
    expect(rules).toMatchObject({ city: "Greater Noida", locality: "Sector MU", bhk: 3, areaSqft: 1650, priceInr: 18_000_000, purpose: "sale", kind: "Apartment" });
    expect(rules.projectName).toBe("Hero Homes DMIC Greater Noida");
    expect(rules.configs[0].startingPrice).toBe(true);
    expect(rules.description).not.toMatch(/8707722966/);
  });
  it("takes the AI's answer field by field, and ignores bad values", () => {
    const d = svc.merge(rules, {
      projectName: "Leafsong Retreat", kind: "Spaceship", purpose: "sale",
      configs: [{ bhk: 3, areaSqft: 2200, priceInr: 0 }, { bhk: 3, areaSqft: 1650, priceInr: 18_000_000, startingPrice: true }, { bhk: 3, areaSqft: -5, priceInr: 1 }],
      notes: ["Land area is given as both 4.5 and 4.70 acres."],
    }, "claude");
    expect(d.source).toBe("claude");
    expect(d.projectName).toBe("Leafsong Retreat");
    expect(d.kind).toBe("Apartment");
    expect(d.configs.map((c) => c.areaSqft)).toEqual([1650, 2200]);
    expect(d.priceInr).toBe(18_000_000);
    expect(d.notes).toContain("Land area is given as both 4.5 and 4.70 acres.");
  });
});

describe("which city a page is about", () => {
  it("trusts the link and title over cities named in menus", () => {
    const menu = "Projects in Greater Noida | Noida | Mumbai | Pune\nGodrej Aristocrat, Sector 49, Gurugram\nGreater Noida West launches";
    expect(pickCity("https://www.godrejproperties.com/gurugram/residential/godrej-aristocrat", "Godrej Aristocrat", menu)).toBe("Gurgaon");
    expect(pickCity("https://example.in/", "Skyline Towers", "Live in Noida. Noida's best. Delhi is near.")).toBe("Noida");
    expect(pickCity("https://example.in/", "", "Greater Noida West homes")).toBe("Greater Noida");
  });
});

describe("home types on a project page", () => {
  it("pairs each card's bedrooms with its size, ignoring sizes in long sentences", () => {
    const text = ["The development offers spacious 3BHK residences ranging from 1650 sq.ft. (3BHK + 2T) to 1850 sq.ft. (3BHK + 3T), along with expansive 2200 sq.ft. homes.",
      "3 BHK", "3 BHK + 2 Toilets", "SIZE • 1,650 Sq. Ft.", "REQUEST DETAILS", "3 BHK + SERVANT", "3 BHK + 3 Toilets", "SIZE • 1,900 Sq. Ft.",
      "3 BHK + Servant", "SIZE • 2,200 Sq. Ft.", "Grand Clubhouse", "A sprawling 25,000+ sq.ft. active space"].join("\n");
    expect(homeCards(text).map((c) => [c.bhk, c.areaSqft])).toEqual([[3, 1650], [3, 1900], [3, 2200]]);
  });
});

describe("imported photos", () => {
  it("are checked by their bytes, not the server's word", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF0000WEBPVP8 "), Buffer.alloc(8)]))?.mime).toBe("image/webp");
    expect(sniffImage(Buffer.from("<html><body>not a photo</body></html>"))).toBeNull();
  });
});

describe("Bright Data Web Unlocker", () => {
  it("sends the zone and link to the direct API, with the key as a bearer token", async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { sent = { url, init }; return new Response("<html><body>Flat for sale</body></html>", { status: 200 }); }) as unknown as typeof fetch;
    const html = await unlock("https://www.99acres.com/some-listing-spid-X123", { fetchImpl: fake });
    expect(html).toContain("Flat for sale");
    expect(sent!.url).toBe("https://api.brightdata.com/request");
    expect((sent!.init.headers as Record<string, string>).authorization).toBe("Bearer test-brightdata-key");
    expect(JSON.parse(String(sent!.init.body))).toEqual({ zone: "topsqill_unlocker", url: "https://www.99acres.com/some-listing-spid-X123", format: "raw" });
  });
  it("explains a bad key, used-up credits and site errors", async () => {
    const answer = (status: number, headers: Record<string, string> = {}) => (async () => new Response("x", { status, headers })) as unknown as typeof fetch;
    await expect(unlock("https://housing.com/x", { fetchImpl: answer(401) })).rejects.toThrow(/refused the API key/);
    await expect(unlock("https://housing.com/x", { fetchImpl: answer(402) })).rejects.toThrow(/credits are used up/);
    await expect(unlock("https://housing.com/x", { fetchImpl: answer(200, { "x-brd-error": "target site blocked" }) })).rejects.toThrow(/target site blocked/);
  });
  it("never sends private addresses to Bright Data", async () => {
    await expect(unlock("http://169.254.169.254/computeMetadata/v1/", { fetchImpl: (async () => { throw new Error("must not be called"); }) as never })).rejects.toThrow(/private address/);
    const pages = new PageFetcher({} as never, { redis: { incr: async () => { throw new Error("must not be called"); } } } as never);
    const r = await pages.fetch("u1", "http://localtest.me/");
    expect(r.via).toBeNull();
    expect(r.error).toMatch(/private address/);
  });
});

// Shaped like api.sh's documented 99acres listing response.
const ACRES = {
  id: "92192336", url: "https://www.99acres.com/3-bhk-flat-for-sale-in-empire-square-chinchwad-pune-1216-sqft-spid-Y92192336",
  title: "3 BHK Apartment / Flat for sale in Empire Square Chinchwad Pune - 1216 Sqft", purpose: "sale", type: "Flat",
  price: 18200000, price_text: "₹1.82 Cr", bedrooms: 3, bathrooms: 3, super_builtup_sqft: null, builtup_sqft: null, carpet_sqft: 1216,
  furnishing: "Semifurnished", facing: "West", availability: "Immediate", city: "Pune", locality: "Chinchwad",
  latitude: 18.6298, longitude: 73.7997, photos: [{ url: "https://imagecdn.99acres.com/media1/1/2/photo1.jpg", caption: "Living room" }, "https://imagecdn.99acres.com/media1/1/2/photo2.webp"],
  amenities: ["LIFT", "SWIMMING_POOL"], description: "Spacious flat posted by the owner.", credits_used: 1, cached: false,
};
// As 99acres really answers: a placeholder RERA, the city inside the locality, feature lists, nearby places, and who posted it.
const ACRES_REAL = {
  ...ACRES, rera: "RERA", locality: "Chinchwad, Pune", amenities: undefined,
  internal_features: ["1 Covered Parking", "Gated Society"], external_features: ["Security Guard", "Piped-gas"],
  usps: ["Vaastu Compliant", "Close to Metro Station"], floor: "5", total_floors: 22,
  nearby: [{ name: "City clinic", category: "Clinic", distance: "0.2 km" }, { name: "Chinchwad metro station", category: "Metro Station", distance: "0.9 km" }, { name: "Elpro City Square", category: "Shopping", distance: "1.2 km" }],
  advertiser: { type: "Owner", name: "Ramesh Testname", photo: "https://static.99acres.com/images/owner_pnava.png", phone: "9800000000" },
};

describe("api.sh", () => {
  it("sends portal listings to their own endpoints, and other links to the page reader", () => {
    expect(apishEndpointFor(ACRES.url).path).toBe("/99acres/v1/listing");
    expect(apishEndpointFor("https://www.magicbricks.com/propertyDetails/3-BHK-1356-Sq-ft-Apartment-FOR-Sale-Juhu-in-Mumbai&id=4d42").path).toBe("/magicbricks/v1/listing");
    expect(apishEndpointFor("https://www.magicbricks.com/shelton-elite-juhu-mumbai-pdpid-4d4235333336313133").path).toBe("/magicbricks/v1/project");
    expect(apishEndpointFor("https://www.nobroker.in/property/3-bhk-apartment-for-rent-in-padmanabhanagar/ff8081816e16355c016e176ab7676387/detail").path).toBe("/nobroker/v1/listing");
    expect(apishEndpointFor("https://housing.com/in/buy/resale/page/123-3-bhk").path).toBe("/web/v1/page");
  });
  it("calls the endpoint with the key header and explains its errors", async () => {
    let called = "", key = "";
    const ok = (async (u: string, init: RequestInit) => { called = u; key = (init.headers as Record<string, string>)["x-api-key"]; return new Response(JSON.stringify(ACRES), { status: 200, headers: { "x-credits-used": "1" } }); }) as unknown as typeof fetch;
    const r = await readViaApish(ACRES.url, { fetchImpl: ok });
    expect(called).toContain("https://api.api.sh/99acres/v1/listing?url=");
    expect(called).toContain("raw=0");
    expect(key).toBe("ash_test_key");
    expect(r.portal).toBe("99acres");
    const fail = (status: number) => (async () => new Response(JSON.stringify({ success: false, error: "x" }), { status })) as unknown as typeof fetch;
    const fresh = () => new KeyPool("test", () => "ash_test_key", () => undefined);
    await expect(readViaApish(ACRES.url, { fetchImpl: fail(401), keys: fresh() })).rejects.toThrow(/refused the API key/);
    await expect(readViaApish(ACRES.url, { fetchImpl: fail(402), keys: fresh() })).rejects.toThrow(/credits are used up/);
    await expect(readViaApish("http://169.254.169.254/latest", { fetchImpl: ok })).rejects.toThrow(/private address/);
  });
  it("turns a portal listing into photos, a map pin and exact facts", () => {
    const p = pageFromApish(ACRES, ACRES.url);
    expect(p.images.map((i) => i.url)).toEqual(["https://imagecdn.99acres.com/media1/1/2/photo1.jpg", "https://imagecdn.99acres.com/media1/1/2/photo2.webp"]);
    expect([p.lat, p.lng]).toEqual([18.6298, 73.7997]);
    expect(p.text).toContain("carpet sqft: 1216");
    expect(portalFacts(ACRES)).toMatchObject({ purpose: "sale", kind: "Apartment", bhk: 3, areaSqft: 1216, priceInr: 18200000, city: "Pune", locality: "Chinchwad", furnishing: "Semi-furnished", facing: "West facing", possession: "Ready to move" });
    expect(portalFacts({ kind: "RENT", rent: 22000, price: null, type: "3 BHK", size_sqft: 1100, city: "bangalore" })).toMatchObject({ purpose: "rent", priceInr: 22000, bhk: 3, areaSqft: 1100, city: "Bangalore" });
  });
  it("drafts from the facts, not the portal's own description", () => {
    const svc = new ListingImportService({} as never, {} as never, {} as never);
    const p = pageFromApish(ACRES, ACRES.url);
    const d = svc.withPortalFacts(svc.rules(ACRES.url, p, p.text), ACRES);
    expect(d).toMatchObject({ bhk: 3, areaSqft: 1216, priceInr: 18200000, city: "Pune", locality: "Chinchwad" });
    expect(d.title).toBe("3 BHK apartment in Chinchwad");
    expect(d.description).not.toContain("posted by the owner");
  });
  it("keeps the portal's floor plans, labelled", () => {
    const p = pageFromApish({ title: "x", floor_plans: [{ url: "https://imagecdn.99acres.com/fp/plan1.jpg" }], layout_image: "https://imagecdn.99acres.com/fp/site.png" }, "https://www.99acres.com/x-spid-N1");
    expect(p.images).toEqual([{ url: "https://imagecdn.99acres.com/fp/plan1.jpg", alt: "Floor plan" }, { url: "https://imagecdn.99acres.com/fp/site.png", alt: "Floor plan" }]);
  });
  it("never takes in who posted the listing", () => {
    const p = pageFromApish(ACRES_REAL, ACRES_REAL.url);
    expect(p.text).not.toMatch(/Ramesh|Testname|9800000000/);
    expect(p.images.some((i) => i.url.includes("owner_"))).toBe(false);
  });
  it("ignores a placeholder RERA, keeps the locality short, and uses the portal's own lists", () => {
    const f = portalFacts(ACRES_REAL);
    expect(f.reraNumber).toBe("");
    expect(portalFacts({ ...ACRES_REAL, rera: "UPRERAPRJ123456" }).reraNumber).toBe("UPRERAPRJ123456");
    expect(f.locality).toBe("Chinchwad");
    expect(f.amenities).toEqual(["1 Covered Parking", "Gated Society", "Security Guard", "Piped-gas"]);
    expect(f.usps.slice(0, 2)).toEqual(["Chinchwad Metro Station, 0.9 km", "Elpro City Square, 1.2 km"]);
    expect(f.usps).not.toContain("City clinic, 0.2 km");
    expect(f.floor).toBe("5th floor of 22");
  });
  it("is preferred over Bright Data when both keys are set", () => {
    expect(new PageFetcher({} as never, {} as never).provider).toBe("apish");
  });
});

describe("several api.sh keys", () => {
  it("reads one key per line, or comma separated, without duplicates", () => {
    expect(parseKeys("ash_live_aaaa1111\n ash_live_bbbb2222 , ash_live_aaaa1111\n\n# old: ash_x")).toEqual(["ash_live_aaaa1111", "ash_live_bbbb2222"]);
  });
  it("moves to the next key when one is refused or out of credits, and remembers it", async () => {
    const pool = new KeyPool("test", () => "ash_live_key1111\nash_live_key2222\nash_live_key3333", () => undefined);
    const used: string[] = [];
    const answers: Record<string, number> = { ash_live_key1111: 402, ash_live_key2222: 401, ash_live_key3333: 200 };
    const fake = (async (_u: string, init: RequestInit) => {
      const k = (init.headers as Record<string, string>)["x-api-key"]; used.push(k);
      return new Response(JSON.stringify(answers[k] === 200 ? ACRES : { success: false, error: "nope" }), { status: answers[k] });
    }) as unknown as typeof fetch;
    const r = await readViaApish(ACRES.url, { fetchImpl: fake, keys: pool });
    expect(r.key).toBe("…3333");
    expect(used).toEqual(["ash_live_key1111", "ash_live_key2222", "ash_live_key3333"]);
    const status = await pool.status();
    expect(status.keys.map((k) => k.state)).toEqual(["no-credits", "rejected", "ok"]);
    expect(JSON.stringify(status)).not.toContain("ash_live_key1111");   // never shown in full
    // The next call goes straight to the working key.
    used.length = 0;
    await readViaApish(ACRES.url, { fetchImpl: fake, keys: pool });
    expect(used).toEqual(["ash_live_key3333"]);
    // Reload gives them all another chance.
    pool.reload();
    expect((await pool.usable()).length).toBe(3);
  });
  it("says so when every key has failed", async () => {
    const pool = new KeyPool("test", () => "ash_live_only1111", () => undefined);
    const fake = (async () => new Response(JSON.stringify({ success: false }), { status: 402 })) as unknown as typeof fetch;
    await expect(readViaApish(ACRES.url, { fetchImpl: fake, keys: pool })).rejects.toThrow(/credits are used up/);
    await expect(readViaApish(ACRES.url, { fetchImpl: fake, keys: pool })).rejects.toThrow(/Every api.sh key is out of credits/);
  });
});
