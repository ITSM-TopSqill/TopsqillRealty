import { describe, it, expect, vi } from "vitest";
// The services below read settings when loaded.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://x@localhost/x";
  process.env.JWT_SECRET ??= "test-secret-at-least-16";
  process.env.REDIS_URL ??= "redis://127.0.0.1:1";
});
import { isPrivateAddress, checkUrl, cleanUrl, safeFetch } from "../src/common/safe-fetch";
import { videoEmbed, tourEmbed } from "../src/common/embeds";
import { readPage, coordsOf } from "../src/ai/page-reader";
import { sniffImage } from "../src/media/media.service";
import { ListingImportService, homeCards } from "../src/ai/listing-import.service";
import { cleanLinks } from "../src/listings/listings.service";

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
  const svc = new ListingImportService({} as never, {} as never);
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
