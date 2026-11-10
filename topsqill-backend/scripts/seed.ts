/**
 * Demo data: a full, believable Topsqill.ai so every screen can be seen filled in.
 *
 *   SEED_OWNER_EMAIL   the account to wire the demo around (default contact@topsqill.com).
 *                      It gets connections, invitations, chats, alerts, leads, lead sources,
 *                      listings, campaigns, a draft project and saved homes. Created if missing.
 *   SEED_OWNER_ADMIN   "true" also makes that account an admin, to see the admin console.
 *   DEMO_MEMBERS       how many demo members to create (default 150).
 *   SEED_RESET_ONLY    "true" removes the demo data and adds nothing.
 *
 * Safe to run again: every row it creates is recorded in `_demo_seed`, and a run
 * first removes the previous demo data (and anything real members attached to it,
 * such as likes or chats with demo members). Real members' own data is never touched.
 *
 * Demo members have @demo.topsqill.ai addresses that are not verified, so nobody can
 * sign in as them. Photos are linked from Unsplash.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { randomBytes } from "node:crypto";
import { env } from "../src/common/env";
import { poolConfig } from "../src/db/pool-config";
import * as s from "../src/db/schema";
import { buildPlan, forecast, segmentOf } from "../src/campaigns/planner";
import { pincodesFor } from "../src/campaigns/pincodes";

type Db = ReturnType<typeof drizzle<typeof s>>;

/* ------------------------------ randomness ------------------------------ */

// Seeded, so two runs produce the same town.
let state = 20261110;
const rnd = () => { state |= 0; state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rint = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const sample = <T,>(a: readonly T[], n: number): T[] => { const c = [...a]; const out: T[] = []; while (c.length && out.length < n) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return out; };
const weighted = <T,>(pairs: [T, number][]): T => { let r = rnd() * pairs.reduce((n, [, w]) => n + w, 0); for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; } return pairs[0][0]; };
const daysAgo = (d: number, jitterH = 20) => new Date(Date.now() - d * 864e5 - rint(0, jitterH) * 36e5 - rint(0, 59) * 6e4);
const round = (n: number, to: number) => Math.round(n / to) * to;
const id = () => uuidv7();

/* -------------------------------- places -------------------------------- */

// Average sale rate per sq ft, roughly what these localities trade at.
const CITIES: Record<string, { w: number; locs: [string, number][] }> = {
  Gurgaon: { w: 26, locs: [["Golf Course Road", 21000], ["Golf Course Extension", 15500], ["Sector 65", 16000], ["Dwarka Expressway", 11500], ["Sohna Road", 9500], ["DLF Phase 5", 24000], ["Sector 57", 12500], ["Sector 82", 10500]] },
  Noida: { w: 20, locs: [["Sector 150", 10500], ["Sector 128", 13500], ["Sector 137", 8500], ["Sector 75", 8000], ["Sector 107", 9800], ["Sector 18", 11000]] },
  Delhi: { w: 10, locs: [["Vasant Kunj", 22000], ["Saket", 26000], ["Dwarka", 13000], ["Greater Kailash", 38000]] },
  Mumbai: { w: 14, locs: [["Powai", 28000], ["Andheri West", 30000], ["Thane West", 15500], ["Chembur", 26000], ["Bandra West", 55000]] },
  Bengaluru: { w: 14, locs: [["Whitefield", 9500], ["Sarjapur Road", 8800], ["HSR Layout", 14500], ["Hebbal", 12500], ["Koramangala", 18000]] },
  Pune: { w: 8, locs: [["Hinjewadi", 7800], ["Baner", 11500], ["Kharadi", 10500], ["Wakad", 8500]] },
  Hyderabad: { w: 8, locs: [["Gachibowli", 10500], ["Kokapet", 11000], ["Kondapur", 9500], ["Madhapur", 11500]] },
};
const CITY_NAMES = Object.keys(CITIES);
const cityPick = () => weighted(CITY_NAMES.map((c) => [c, CITIES[c].w] as [string, number]));
const rateOf = (city: string, loc: string) => CITIES[city].locs.find(([l]) => l === loc)?.[1] ?? 9000;

const FIRST_M = ["Aarav", "Vikram", "Rohit", "Karan", "Imran", "Rahul", "Arjun", "Siddharth", "Aditya", "Nikhil", "Varun", "Manish", "Gaurav", "Harsh", "Kunal", "Rajat", "Sameer", "Deepak", "Ankit", "Yash", "Pranav", "Abhishek", "Sandeep", "Tarun"];
const FIRST_F = ["Riya", "Ananya", "Neha", "Priya", "Simran", "Meera", "Kavya", "Ishita", "Pooja", "Sneha", "Aditi", "Tanvi", "Shreya", "Nisha", "Divya", "Aisha", "Radhika", "Swati", "Pallavi", "Komal"];
const LAST = ["Sharma", "Verma", "Mehta", "Kapoor", "Singh", "Iyer", "Nair", "Reddy", "Patel", "Khan", "Gill", "Bose", "Malhotra", "Chopra", "Agarwal", "Joshi", "Rao", "Menon", "Bhatia", "Saxena", "Kulkarni", "Desai", "Arora", "Sethi", "Pillai", "Chauhan"];
const AGENCIES = ["Skyline Realty", "Keystone Estates", "Urban Nest Advisors", "Prime Acres Realty", "Harbour Homes", "Blue Door Properties", "Landmark Realty Partners", "Cornerstone Advisors", "Northstar Estates", "Silver Oak Realty", "Address Hunt", "Brick & Key"];
const BUILDERS = ["Aravali Developers", "Sunridge Infra", "Meridian Buildcon", "Greenfield Homes", "Vertex Realtors", "Lotus Crest Builders", "Orchid Spaces", "Riverstone Developers"];

/* -------------------------------- photos -------------------------------- */

const U = (photo: string, w: number) => `https://images.unsplash.com/photo-${photo}?w=${w}&q=72&auto=format&fit=crop`;
const EXTERIOR = ["1600596542815-ffad4c1539a9", "1600585154340-be6161a56a0c", "1564013799919-ab600027ffc6", "1512917774080-9991f1c4c750", "1545324418-cc1a3fa10c00", "1580587771525-78b9dba3b914", "1568605114967-8130f3a36994", "1570129477492-45c003edd2be", "1515263487990-61b07816b324", "1574362848149-11496d93a7c7", "1613490493576-7fde63acd811", "1605276374104-dee2a0ed3cd6", "1600047509807-ba8f99d2cdde"];
const INTERIOR: [string, string][] = [["1502672260266-1c1ef2d93688", "Living room"], ["1522708323590-d24dbb6b0267", "Living room"], ["1560448204-e02f11c3d0e2", "Bedroom"], ["1493809842364-78817add7ffb", "Living room"], ["1600607687939-ce8a6c25118c", "Living room"], ["1484154218962-a197022b5858", "Kitchen"], ["1560185007-cde436f6a4d0", "Bedroom"], ["1600566753190-17f0baa2a6c3", "Kitchen"], ["1586023492125-27b2c045efd7", "Living room"], ["1600210492486-724fe5c67fb0", "Dining"], ["1600573472550-8090b5e0745e", "Bedroom"]];

/* ------------------------------ bookkeeping ------------------------------ */

const created: Record<string, string[]> = {};
const track = (table: string, ids: string[]) => { (created[table] ??= []).push(...ids); };

async function insertMany<T extends Record<string, unknown>>(db: Db, table: Parameters<Db["insert"]>[0], rows: T[], trackAs?: string, chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) await db.insert(table).values(rows.slice(i, i + chunk) as never).onConflictDoNothing();
  if (trackAs) track(trackAs, rows.map((r) => r.id as string));
}

/* --------------------------------- main --------------------------------- */

async function main() {
  const pool = new Pool(poolConfig(env.DATABASE_URL, { max: 4 }));
  const db = drizzle(pool, { schema: s });
  console.time("seed");
  await pool.query(`create table if not exists _demo_seed (tbl text not null, id text not null, primary key (tbl, id))`);

  await reset(pool, db);
  if (process.env.SEED_RESET_ONLY === "true") { console.log("demo data removed"); await pool.end(); return; }

  const owner = await ensureOwner(db);
  const N = Math.max(30, Number(process.env.DEMO_MEMBERS ?? 150));

  /* ------------------------------ members ------------------------------ */
  type Member = typeof s.users.$inferInsert & { id: string; type: "buyer" | "seller" | "dealer" | "builder"; city: string; localities: string[]; name: string };
  const members: Member[] = [];
  const usedEmails = new Set<string>();
  for (let i = 0; i < N; i++) {
    const female = chance(0.42);
    const first = pick(female ? FIRST_F : FIRST_M), last = pick(LAST);
    const type = weighted<Member["type"]>([["dealer", 45], ["buyer", 25], ["seller", 18], ["builder", 12]]);
    const city = cityPick();
    const locs = sample(CITIES[city].locs.map(([l]) => l), rint(1, 3));
    const agency = type === "dealer" ? pick(AGENCIES) : type === "builder" ? pick(BUILDERS) : null;
    const name = type === "builder" && chance(0.35) ? agency! : `${first} ${last}`;
    let email = `${first}.${last}`.toLowerCase();
    while (usedEmails.has(email)) email += rint(1, 9);
    usedEmails.add(email);
    const years = type === "dealer" || type === "builder" ? rint(2, 22) : null;
    const created = i < N * 0.1 ? daysAgo(rint(0, 6)) : daysAgo(rint(7, 120));
    members.push({
      id: id(), email: `${email}@demo.topsqill.ai`, emailVerified: false, phone: null, name, type, city, localities: locs,
      status: i % 37 === 5 ? "pending" : "active",
      kycVerified: type !== "buyer" && chance(0.65), reraVerified: type === "dealer" && chance(0.7),
      reraNumber: type === "dealer" ? reraFor(city) : null, agency, yearsExperience: years,
      headline: headlineFor(type, locs[0], city, agency, years),
      about: aboutFor(type, locs, city, agency, years),
      createdAt: created, updatedAt: created, lastSeenAt: daysAgo(rint(0, 5)),
    });
  }
  const safety: Member = {
    id: id(), email: "trust@demo.topsqill.ai", emailVerified: false, phone: null, name: "Topsqill Trust & Safety", type: "dealer",
    city: "Gurgaon", localities: [], status: "active", isAdmin: true, headline: "Keeping the network genuine", createdAt: daysAgo(150),
  };
  await insertMany(db, s.users, [...members, safety], "users");
  const active = members.filter((m) => m.status === "active");
  const pros = active.filter((m) => m.type === "dealer" || m.type === "builder");
  console.log(`members: ${members.length}`);

  /* ------------------------------ listings ------------------------------ */
  const mediaRows: (typeof s.media.$inferInsert)[] = [];
  const linkRows: (typeof s.listingMedia.$inferInsert)[] = [];
  const photo = (ownerId: string, photoId: string, label: string, group: string) => {
    const m = { id: id(), ownerId, kind: "image" as const, status: "ready" as const, objectPath: `demo/unsplash/${photoId}`, mimeType: "image/jpeg",
      width: 1920, height: 1280, label, groupName: group,
      variants: { thumb_jpeg: U(photoId, 160), card_jpeg: U(photoId, 640), large_jpeg: U(photoId, 1280), full_jpeg: U(photoId, 1920) } };
    mediaRows.push(m);
    return m.id;
  };

  type L = typeof s.listings.$inferInsert & { id: string; city: string; locality: string; purpose: "sale" | "rent" };
  const listings: L[] = [];
  const makeListing = (ownerId: string, city: string, locality: string, ageDays: number, onlyKind?: string): L => {
    const kind = onlyKind ?? weighted([["Apartment", 62], ["Builder floor", city === "Gurgaon" || city === "Delhi" ? 14 : 2], ["Villa", 7], ["Plot", 6], ["Office", 6], ["Shop", 5]]);
    const residential = ["Apartment", "Builder floor", "Villa"].includes(kind);
    const purpose: "sale" | "rent" = chance(kind === "Office" || kind === "Shop" ? 0.5 : 0.24) ? "rent" : "sale";
    const bhk = residential ? weighted([[2, 30], [3, 42], [4, 20], [5, 5], [1, 3]]) : null;
    const area = kind === "Plot" ? rint(150, 500) * 9 : kind === "Office" ? rint(6, 40) * 100 : kind === "Shop" ? rint(2, 9) * 100
      : round((bhk ?? 2) * rint(520, 700) + (kind === "Villa" ? 1600 : 0), 5);
    const rate = rateOf(city, locality) * (kind === "Villa" ? 1.25 : kind === "Plot" ? 0.8 : kind === "Builder floor" ? 0.85 : 1) * (0.85 + rnd() * 0.35);
    const sale = round(area * rate, 100000);
    const price = purpose === "rent" ? round(sale * (0.0022 + rnd() * 0.0008), 1000) : sale;
    const possession = residential ? (chance(0.7) ? "Ready to move" : "Under construction") : "Ready to move";
    const facing = pick(["East facing", "North-east facing", "Park facing", "Corner unit", "Pool facing", "Road facing", "Golf course view"]);
    const amenities = residential ? sample(["Clubhouse", "Swimming pool", "Gym", "Power backup", "Covered parking", "24x7 security", "Kids play area", "Jogging track", "Lift", "Visitor parking", "Rainwater harvesting", "Indoor games", "Tennis court", "EV charging"], rint(4, 8))
      : sample(["Power backup", "Lift", "Visitor parking", "24x7 security", "Fire safety", "High-street frontage", "Central AC"], rint(3, 5));
    const title = residential
      ? `${bhk} BHK ${kind === "Apartment" ? pick(["apartment", "flat", "residence"]) : kind.toLowerCase()} in ${locality}${chance(0.4) ? `, ${facing.toLowerCase()}` : ""}`
      : kind === "Plot" ? `${Math.round(area / 9)} sq yd plot in ${locality}` : `${area.toLocaleString("en-IN")} sq ft ${kind.toLowerCase()} in ${locality}`;
    const published = daysAgo(ageDays);
    return {
      id: id(), ownerId, status: chance(0.06) ? "sold" : "active", title: title.slice(0, 140), purpose, kind, bhk, areaSqft: area, priceInr: price,
      city, locality, possession, furnishing: residential ? pick(["Unfurnished", "Semi-furnished", "Fully furnished"]) : null, facing,
      description: descriptionFor(kind, bhk, locality, city, area, facing, amenities, possession, purpose),
      amenities, usps: sample([`${Math.round(rnd() * 8 + 2)} minutes to the metro`, "Clear title, bank approved", `Possession ${possession === "Ready to move" ? "immediately" : "by Dec 2027"}`, "Low maintenance charges", "Wide balconies with open views", "Vastu compliant layout", "Gated community", "Close to schools and hospitals"], 3),
      reraNumber: purpose === "sale" && residential ? `RERA-${city.slice(0, 3).toUpperCase()}-${rint(10000, 99999)}` : null,
      verified: chance(0.45), viewCount: rint(30, 2400), saveCount: rint(0, 90), leadCount: rint(0, 25),
      publishedAt: published, createdAt: published, updatedAt: published,
    };
  };
  for (const m of active) {
    const n = m.type === "builder" ? rint(2, 5) : m.type === "dealer" ? rint(1, 4) : m.type === "seller" ? rint(1, 2) : 0;
    for (let k = 0; k < n; k++) listings.push(makeListing(m.id, m.city, pick(m.localities), rint(0, 75)));
  }
  const ownerCity = owner.city && CITIES[owner.city] ? owner.city : "Gurgaon";
  // Homes for sale, so the campaign studio and lead board look like a dealer's real week.
  const forSale = (loc: string, i: number) => { let l: L; do { l = makeListing(owner.id, ownerCity, loc, i * 6 + 1, i === 4 ? "Villa" : "Apartment"); } while (l.purpose !== "sale"); l.status = "active"; return l; };
  const ownerListings = CITIES[ownerCity].locs.slice(0, 6).map(([loc], i) => forSale(loc, i));
  listings.push(...ownerListings);

  for (const l of listings) {
    const cover = photo(l.ownerId, pick(EXTERIOR), "Exterior", "exterior");
    l.coverMediaId = cover;
    linkRows.push({ listingId: l.id, mediaId: cover, position: 0 });
    sample(INTERIOR, rint(2, 4)).forEach(([p, label], i) => linkRows.push({ listingId: l.id, mediaId: photo(l.ownerId, p, label, "interior"), position: i + 1 }));
  }
  await insertMany(db, s.media, mediaRows, "media");
  await insertMany(db, s.listings, listings, "listings");
  await insertMany(db, s.listingMedia, linkRows);
  console.log(`listings: ${listings.length}`);

  /* ------------------------------ projects ------------------------------ */
  const builders = active.filter((m) => m.type === "builder");
  const projectRows: (typeof s.projects.$inferInsert)[] = [];
  const PROJECT_NAMES = ["Aravali Heights", "Skyline Residences", "The Orchid Towers", "Riverstone Greens"];
  PROJECT_NAMES.forEach((name, i) => {
    const mine = i === PROJECT_NAMES.length - 1;
    const b = mine ? null : builders[i % Math.max(builders.length, 1)];
    const city = mine ? ownerCity : b?.city ?? "Gurgaon";
    const locality = mine ? CITIES[ownerCity].locs[1][0] : pick(b?.localities.length ? b.localities : [CITIES[city].locs[0][0]]);
    const rate = rateOf(city, locality);
    const configs = [2, 3, 4].map((bhk) => { const sbua = bhk * 620 + rint(0, 200); return { bhk, sbua, carpet: Math.round(sbua * 0.72), price: round(sbua * rate * (0.95 + rnd() * 0.15), 100000) }; });
    projectRows.push({
      id: id(), ownerId: mine ? owner.id : b!.id, sourceUrl: null, name, builder: mine ? "Riverstone Developers" : b!.agency ?? b!.name, city, locality,
      reraNumber: `RERA-${city.slice(0, 3).toUpperCase()}-PRJ-${rint(1000, 9999)}`, status: pick(["New launch", "Under construction", "Ready to move"]),
      possession: pick(["Dec 2026", "Jun 2027", "Mar 2028"]), acres: String(rint(5, 22)), towers: rint(4, 11), floors: rint(18, 42), units: rint(380, 1400), openArea: rint(70, 82),
      paymentPlan: pick(["30:70", "Construction linked", "20:80 subvention"]), facing: sample(["East", "North", "North-east", "Park"], 2),
      amenities: sample(["Clubhouse of 50,000 sq ft", "Olympic-length pool", "Sky deck", "Co-working lounge", "Pet park", "Amphitheatre", "Squash court", "Spa", "Mini theatre", "Organic garden", "Cricket pitch", "Kids' splash pool"], 8),
      specs: ["Vitrified tiles in living areas", "Modular kitchen with chimney", "VRV air conditioning", "Double-glazed windows", "Wooden flooring in the master bedroom", "Video door phone"],
      configs, nearby: [{ name: "Metro station", km: +(rnd() * 2 + 0.5).toFixed(1), icon: "🚇" }, { name: "International school", km: +(rnd() * 3 + 0.8).toFixed(1), icon: "🏫" }, { name: "Multi-speciality hospital", km: +(rnd() * 4 + 1).toFixed(1), icon: "🏥" }, { name: "Shopping mall", km: +(rnd() * 4 + 1).toFixed(1), icon: "🛍" }, { name: "Airport", km: rint(14, 35), icon: "✈️" }],
      usps: ["Low density: only 4 homes per floor", `${rint(70, 82)}% open green area`, "Every home is a corner home", "Possession-linked payment plan"],
      summary: `${name} is a ${configs.length}-configuration gated community in ${locality}, ${city}, with ${configs.map((c) => `${c.bhk} BHK`).join(", ")} homes across landscaped towers. Most of the site is open green space and the clubhouse is ready ahead of possession.`,
      verdict: `Priced close to the ${locality} average of ₹${rate.toLocaleString("en-IN")} per sq ft, with a reputed builder and strong rental demand nearby.`,
      risk: { score: rint(68, 88), level: "Low", factors: [{ label: "Builder track record", level: "low", note: "Delivered earlier projects on time" }, { label: "Price vs locality", level: "medium", note: "About 5% above the locality average" }, { label: "RERA registration", level: "low", note: "Registration number provided" }] },
      priceEstimated: false, aiSource: "rules", published: !mine, createdAt: daysAgo(rint(5, 40)),
    });
  });
  await insertMany(db, s.projects, projectRows, "projects");
  // Published projects get their live listings, linked back to the project page.
  const projectListings: L[] = [];
  for (const p of projectRows.filter((x) => x.published)) {
    for (const c of p.configs!) {
      const l = makeListing(p.ownerId, p.city, p.locality, rint(2, 30));
      Object.assign(l, { kind: "Apartment", purpose: "sale", status: "active", bhk: c.bhk, areaSqft: c.sbua, priceInr: c.price, title: `${c.bhk} BHK in ${p.name}, ${p.locality}`, projectSourceId: p.id, projectId: p.id, possession: p.status === "Ready to move" ? "Ready to move" : "Under construction", amenities: p.amenities, usps: p.usps, description: p.summary });
      projectListings.push(l);
    }
  }
  const pMedia: (typeof s.media.$inferInsert)[] = [];
  const pLinks: (typeof s.listingMedia.$inferInsert)[] = [];
  mediaRows.length = 0;
  for (const l of projectListings) {
    const cover = photo(l.ownerId, pick(EXTERIOR), "Exterior", "exterior");
    l.coverMediaId = cover; pLinks.push({ listingId: l.id, mediaId: cover, position: 0 });
    sample(INTERIOR, 3).forEach(([ph, label], i) => pLinks.push({ listingId: l.id, mediaId: photo(l.ownerId, ph, label, "interior"), position: i + 1 }));
  }
  pMedia.push(...mediaRows);
  await insertMany(db, s.media, pMedia, "media");
  await insertMany(db, s.listings, projectListings, "listings");
  await insertMany(db, s.listingMedia, pLinks);
  listings.push(...projectListings);
  const liveListings = listings.filter((l) => l.status === "active");

  /* ---------------------------- connections ---------------------------- */
  const conn = new Map<string, typeof s.connections.$inferInsert>();
  const connect = (a: string, b: string, status: "accepted" | "pending", by: string, at: Date) => {
    if (a === b || conn.has(`${a}|${b}`)) return;
    conn.set(`${a}|${b}`, { userId: a, peerId: b, status, requestedBy: by, createdAt: at });
    conn.set(`${b}|${a}`, { userId: b, peerId: a, status, requestedBy: by, createdAt: at });
  };
  for (const m of active) for (let k = 0; k < rint(5, 14); k++) { const p = pick(active); connect(m.id, p.id, "accepted", m.id, daysAgo(rint(1, 90))); }
  const ownerPeers = sample(active, Math.min(45, active.length));
  ownerPeers.forEach((p) => connect(owner.id, p.id, "accepted", chance(0.5) ? owner.id : p.id, daysAgo(rint(1, 80))));
  const inviters = sample(active.filter((m) => !ownerPeers.includes(m)), 6);
  inviters.forEach((p, i) => connect(owner.id, p.id, "pending", p.id, daysAgo(i, 10)));
  await insertMany(db, s.connections, [...conn.values()]);

  /* ---------------------------- requirements ---------------------------- */
  const reqRows: (typeof s.requirements.$inferInsert)[] = [];
  const seekers = active.filter((m) => m.type === "buyer" || m.type === "dealer");
  const makeReq = (userId: string, city: string, ageDays: number) => {
    const purpose: "sale" | "rent" = chance(0.25) ? "rent" : "sale";
    const locs = sample(CITIES[city].locs.map(([l]) => l), rint(1, 3));
    const bhk = weighted([[2, 30], [3, 45], [4, 20], [5, 5]]);
    const base = bhk * 640 * rateOf(city, locs[0]);
    const max = purpose === "rent" ? round(base * 0.0028, 5000) : round(base * (1 + rnd() * 0.2), 500000);
    const at = daysAgo(ageDays);
    return {
      id: id(), userId, status: "active" as const, purpose, kind: "Apartment", bhk, city, localities: locs,
      minPrice: round(max * 0.75, purpose === "rent" ? 5000 : 500000), maxPrice: max, minArea: round(bhk * 560, 50),
      timeline: pick(["Immediately", "Within 1 month", "1 to 3 months", "3 to 6 months"]), needsLoan: purpose === "sale" && chance(0.55),
      note: pick([
        "Client is relocating from Bengaluru and wants to close within the month. High floor preferred.",
        "Family of four, needs a good school within 3 km. East or north facing only.",
        "NRI buyer, video walkthrough first. Ready to move, no under-construction.",
        "Investor looking for rental yield above 3%. Will consider two units.",
        "Needs covered parking for two cars and a pet-friendly society.",
        "Budget is firm. Loan pre-approved with HDFC.",
        "Corporate lease, company pays rent. Semi-furnished preferred.",
      ]),
      createdAt: at, updatedAt: at,
    };
  };
  for (let i = 0; i < Math.round(N * 0.55); i++) { const m = pick(seekers); reqRows.push(makeReq(m.id, m.city, rint(0, 45))); }
  reqRows.push(makeReq(owner.id, ownerCity, 2), makeReq(owner.id, ownerCity, 9));
  await insertMany(db, s.requirements, reqRows, "requirements");
  // Matches: same city and purpose, a locality they asked for, right size, within budget.
  await pool.query(`
    insert into requirement_matches (requirement_id, listing_id, score, notified, created_at)
    select requirement_id, listing_id, score, true, now() from (
      select r.id as requirement_id, l.id as listing_id,
        (72 + (abs(hashtext(r.id || l.id)) % 27))::smallint as score,
        row_number() over (partition by r.id order by abs(coalesce(l.price_inr,0) - coalesce(r.max_price,0))) as rn
      from requirements r
      join listings l on l.city = r.city and l.purpose = r.purpose and l.status = 'active' and l.hidden = false
        and (r.bhk is null or l.bhk = r.bhk)
        and (r.localities @> to_jsonb(l.locality) or r.localities = '[]'::jsonb)
        and (r.max_price is null or l.price_inr <= r.max_price * 1.15)
        and (r.min_price is null or l.price_inr >= r.min_price * 0.8)
      where r.id = any($1)
    ) x where rn <= 8
    on conflict do nothing`, [reqRows.map((r) => r.id)]);
  await pool.query(`update requirements r set match_count = (select count(*) from requirement_matches m where m.requirement_id = r.id) where r.id = any($1)`, [reqRows.map((r) => r.id)]);

  /* -------------------------------- jobs -------------------------------- */
  const JOB_TEMPLATES: [string, string, string[]][] = [
    ["Sales Manager", "Sales", ["Site visits", "Negotiation", "Luxury residential", "CRM", "Closing"]],
    ["Relationship Manager", "Sales", ["Client handling", "Follow-ups", "Home loans", "Site visits", "Hindi and English"]],
    ["Pre-sales Executive", "Pre-sales", ["Calling", "Lead qualification", "CRM", "Scheduling site visits", "Hindi"]],
    ["Telecaller", "Pre-sales", ["Outbound calling", "Lead qualification", "Hindi", "Excel", "Follow-ups"]],
    ["Channel Partner Manager", "Channel partners", ["Broker network", "Events", "Negotiation", "Field work", "Relationship building"]],
    ["Digital Marketing Executive", "Marketing", ["Meta ads", "Google Ads", "Lead forms", "Landing pages", "Reporting"]],
    ["Leasing Manager", "Leasing", ["Commercial leasing", "Negotiation", "Corporate clients", "Documentation", "Site visits"]],
    ["Site Engineer", "Site and engineering", ["AutoCAD", "Site supervision", "Quality checks", "Contractor management", "BOQ"]],
    ["CRM Executive", "Operations", ["Customer service", "Documentation", "Payment follow-ups", "Excel", "Registry process"]],
  ];
  const jobRows: (typeof s.jobs.$inferInsert)[] = [];
  const makeJob = (ownerId: string, company: string, city: string, locality: string | null, ageDays: number) => {
    const [title, category, skills] = pick(JOB_TEMPLATES);
    const exp = rint(0, 6);
    const salMin = Math.max(2.5, exp * 1.6 + rint(2, 4));
    return {
      id: id(), ownerId, company, title, category, employment: chance(0.08) ? "Internship" : "Full-time",
      workMode: category === "Sales" || category === "Leasing" || category === "Channel partners" ? "Field" : chance(0.2) ? "Hybrid" : "On-site",
      city, locality, openings: rint(1, 4), expMin: exp, expMax: exp + rint(2, 5),
      salaryMin: String(salMin), salaryMax: String(+(salMin * (1.4 + rnd() * 0.4)).toFixed(1)), incentives: category === "Sales" || chance(0.3),
      skills, summary: `${company} is hiring a ${title} in ${city}. You will work with live inventory and a steady flow of qualified leads, with clear growth for people who deliver.`,
      responsibilities: ["Own the funnel from enquiry to booking", "Run site visits and close deals", "Follow up with every lead the same day", "Keep the CRM accurate and current"],
      requirements: [`${exp}+ years in real estate or a similar role`, "Confident in Hindi and English", "Comfortable with monthly targets", "Own vehicle preferred for site visits"],
      status: "open" as const, applicantCount: 0, createdAt: daysAgo(ageDays),
    };
  };
  for (const m of sample(pros, Math.min(26, pros.length))) jobRows.push(makeJob(m.id, m.agency ?? m.name, m.city, pick(m.localities), rint(0, 40)));
  const ownerJobs = [makeJob(owner.id, owner.agency ?? owner.name, ownerCity, null, 3), makeJob(owner.id, owner.agency ?? owner.name, ownerCity, null, 12)];
  jobRows.push(...ownerJobs);
  const apps: (typeof s.jobApplications.$inferInsert)[] = [];
  for (const j of jobRows) {
    const applicants = sample(active.filter((m) => m.id !== j.ownerId), j.ownerId === owner.id ? rint(5, 9) : rint(0, 7));
    applicants.forEach((a) => apps.push({
      id: id(), jobId: j.id, userId: a.id, note: pick(["I have closed 40+ deals in this micro-market and know the inventory well.", "Looking to move from resale to primary sales. Available to join in 30 days.", "Five years with a top channel partner, strong builder relationships.", "Fluent in Hindi, English and Punjabi. Own two-wheeler."]),
      yearsExperience: a.yearsExperience ?? rint(0, 6), noticePeriod: pick(["Immediate", "15 days", "30 days", "60 days"]), matchScore: rint(55, 96),
      status: weighted([["applied", 50], ["viewed", 25], ["shortlisted", 18], ["rejected", 7]]), createdAt: daysAgo(rint(0, 10)),
    }));
    j.applicantCount = applicants.length;
  }
  if (jobRows[0].ownerId !== owner.id) apps.push({ id: id(), jobId: jobRows[0].id, userId: owner.id, note: "Interested in this role.", status: "viewed", matchScore: 81, createdAt: daysAgo(4) });
  await insertMany(db, s.jobs, jobRows, "jobs");
  await insertMany(db, s.jobApplications, apps, "job_applications");

  /* -------------------------------- posts -------------------------------- */
  const postRows: (typeof s.posts.$inferInsert)[] = [];
  const authorsPool = [...active, ...ownerPeers];
  for (const l of sample(liveListings.filter((l) => l.ownerId !== owner.id), Math.min(70, liveListings.length))) {
    postRows.push({ id: id(), authorId: l.ownerId, kind: "listing", refId: l.id, mediaIds: [l.coverMediaId!],
      body: pick([`Just listed: ${l.title}. ${l.possession}, ${l.facing?.toLowerCase()}. DM for the price sheet and a site visit this weekend. 🏡`,
        `Fresh inventory in ${l.locality}! ${l.title}, ${l.areaSqft?.toLocaleString("en-IN")} sq ft. Serious buyers and co-brokers welcome.`,
        `New mandate: ${l.title}. Clear title, ${l.verified ? "verified on Topsqill.ai" : "papers ready"}. Brokerage shared with co-brokers. 🤝`]),
      createdAt: l.publishedAt as Date });
  }
  const UPDATES = [
    (c: string, l: string) => `Site visits in ${l} are up sharply this month. Buyers are asking for ready-to-move 3 BHKs under ₹2 Cr and there isn't enough inventory. If you have mandates, let's talk. #${c}RealEstate`,
    (c: string, l: string) => `Closed a 4 BHK in ${l} today after six site visits and two rounds of negotiation. Patience pays. 🙏 Thanks to everyone in my network who shared the requirement.`,
    (c: string, l: string) => `Quick market note for ${c}: resale prices in ${l} have moved about 8% in six months, while rents are up 12%. Yield-focused investors are back.`,
    (c: string) => `Hosting a channel partner meet in ${c} next Saturday. New launch inventory, payout of up to 3%, and lunch on us. Comment "IN" and I'll send the invite.`,
    (c: string, l: string) => `Tip for first-time buyers in ${l}: always ask for the occupation certificate and the latest maintenance statement before you pay a token. It saves weeks later.`,
    (c: string) => `Hiring! Two sales managers for our ${c} team. Good incentive structure and live inventory. Check the Jobs tab or message me.`,
    (c: string, l: string) => `Looking for a co-broker with a 3 BHK in ${l} for a corporate client. Budget is flexible for the right floor and view.`,
    (c: string) => `Home loan rates eased slightly this month. Ran the numbers: on a ₹1.5 Cr loan that's roughly ₹1,900 less EMI a month. Worth a call to your clients sitting on the fence in ${c}.`,
  ];
  for (let i = 0; i < Math.round(N * 0.9); i++) {
    const a = pick(authorsPool);
    postRows.push({ id: id(), authorId: a.id, kind: chance(0.15) ? "insight" : "update", body: pick(UPDATES)(a.city, pick(a.localities.length ? a.localities : [a.city])), createdAt: daysAgo(rint(0, 30)) });
  }
  postRows.push(
    { id: id(), authorId: owner.id, kind: "update", body: `Excited to be on Topsqill.ai! Working across ${ownerCity}. Share your requirements and I'll match you with verified inventory. 🏙`, createdAt: daysAgo(20) },
    { id: id(), authorId: owner.id, kind: "listing", refId: ownerListings[0].id, mediaIds: [ownerListings[0].coverMediaId!], body: `New on the market: ${ownerListings[0].title}. Message me for a walkthrough.`, createdAt: daysAgo(1) },
  );
  const likes: (typeof s.postLikes.$inferInsert)[] = [];
  const comments: (typeof s.postComments.$inferInsert)[] = [];
  const COMMENTS = ["Great find! Sharing with my buyer.", "What's the final price? DM'd you.", "Congratulations! 🎉", "Very useful, thanks for sharing.", "Is brokerage shared?", "I have a matching requirement, will call you.", "Agree, inventory is tight right now.", "Can you share the floor plan?", "Interested. Is it still available?", "Spot on analysis 👏"];
  for (const p of postRows) {
    const likers = sample([...active, owner], rint(0, 28));
    likers.forEach((u) => likes.push({ postId: p.id, userId: u.id, createdAt: daysAgo(rint(0, 5)) }));
    p.likeCount = likers.length;
    const nc = chance(0.55) ? rint(1, 4) : 0;
    for (let k = 0; k < nc; k++) comments.push({ id: id(), postId: p.id, authorId: pick(active).id, body: pick(COMMENTS), createdAt: new Date((p.createdAt as Date).getTime() + rint(1, 48) * 36e5) });
    p.commentCount = nc;
    p.repostCount = rint(0, 6);
  }
  await insertMany(db, s.posts, postRows, "posts");
  await insertMany(db, s.postLikes, likes);
  await insertMany(db, s.postComments, comments, "post_comments");

  /* ------------------------------ messages ------------------------------ */
  const THREADS: string[][] = [
    ["Hi! Saw your 3 BHK listing. Is it still available?", "Yes, it is. Would you like to visit this weekend?", "Saturday 11 am works. Can you share the price sheet?", "Sharing now. The owner is flexible for a quick close.", "Great, see you Saturday 👍"],
    ["I have a buyer for your requirement in your area. Budget matches.", "Perfect, can you send details?", "Sending the brochure and floor plan.", "Looks good. Brokerage 1% each side?", "Done. Let's set up a visit."],
    ["Hello, are you open to a co-broking arrangement on the new launch?", "Definitely. What's the payout?", "3% on base price, paid within 30 days of registry.", "Works for me. Send the inventory list."],
    ["Thanks for connecting! I'm looking for a rental for a corporate client.", "Happy to help. Budget and preferred area?", "₹75k a month, near the metro, semi-furnished.", "I have two options. Can share photos tonight.", "Please do, client wants to see by tomorrow."],
    ["Is the price negotiable on the corner unit?", "A little. The owner wants a quick deal.", "My client can do token money this week.", "Let me check with the owner and revert by evening."],
    ["Congrats on the deal you posted!", "Thank you! It took a while 😄", "Let's catch up, I have a few mandates you might like.", "Sure, coffee on Thursday?"],
  ];
  const convs: (typeof s.conversations.$inferInsert)[] = [];
  const msgs: (typeof s.messages.$inferInsert)[] = [];
  sample(ownerPeers, Math.min(10, ownerPeers.length)).forEach((peer, i) => {
    const [a, b] = owner.id < peer.id ? [owner.id, peer.id] : [peer.id, owner.id];
    const cid = id();
    const lines = pick(THREADS);
    const start = daysAgo(i * 2 + 1, 6).getTime();
    const unread = i < 4 ? rint(1, 2) : 0;
    let last: { body: string; at: Date; sender: string } | null = null;
    let clock = start;
    lines.forEach((body, k) => {
      const fromPeer = k % 2 === 0;
      const sender = fromPeer ? peer.id : owner.id;
      // The last few lines from the peer are unread for the most recent chats.
      const isUnread = fromPeer && k >= lines.length - unread * 2;
      clock += rint(4, 40) * 6e4;   // each reply a few minutes after the last
      const at = new Date(clock);
      msgs.push({ id: id(), conversationId: cid, senderId: sender, body, createdAt: at, readAt: isUnread ? null : new Date(at.getTime() + 6e5) });
      last = { body, at, sender };
    });
    const l = last as unknown as { body: string; at: Date; sender: string };
    convs.push({ id: cid, aId: a, bId: b, lastMessageAt: l.at, lastMessagePreview: l.body.slice(0, 160), lastSenderId: l.sender, createdAt: new Date(start) });
  });
  await insertMany(db, s.conversations, convs, "conversations");
  await insertMany(db, s.messages, msgs, "messages");

  /* ------------------------------ lead sources ------------------------------ */
  const sources = [
    { source: "meta" as const, name: "Facebook and Instagram lead ads" }, { source: "google" as const, name: "Google Ads lead forms" },
    { source: "portal_99acres" as const, name: "99acres" }, { source: "website" as const, name: "Website enquiry form" },
  ].map((x, i) => ({ id: id(), ownerId: owner.id, ...x, config: { demo: true }, ingestKey: randomBytes(18).toString("base64url"), enabled: true,
    assignRule: i === 0 ? "round_robin" : "owner", lastEventAt: daysAgo(i, 8), leadCount: 0, createdAt: daysAgo(40 - i * 5) }));
  await insertMany(db, s.leadSources, sources, "lead_sources");

  /* -------------------------------- leads -------------------------------- */
  const LEAD_FIRST = [...FIRST_M, ...FIRST_F];
  const leadRows: (typeof s.leads.$inferInsert)[] = [];
  const acts: (typeof s.leadActivities.$inferInsert)[] = [];
  const SRC: [typeof s.leads.$inferInsert["source"], number][] = [["meta", 30], ["google", 18], ["portal_99acres", 12], ["portal_magicbricks", 8], ["website", 10], ["whatsapp", 8], ["topsqill", 10], ["call", 4]];
  for (let i = 0; i < 42; i++) {
    const l = pick(ownerListings);
    const stage = weighted<NonNullable<typeof s.leads.$inferInsert["stage"]>>([["new", 30], ["contacted", 24], ["site_visit", 18], ["negotiation", 12], ["booked", 8], ["lost", 8]]);
    const score = stage === "booked" ? rint(85, 98) : stage === "lost" ? rint(20, 45) : rint(38, 95);
    const at = daysAgo(stage === "new" ? rint(0, 5) : rint(2, 35));
    const source = weighted(SRC);
    const name = `${pick(LEAD_FIRST)} ${pick(LAST)}`;
    const lid = id();
    leadRows.push({
      id: lid, ownerId: owner.id, assigneeId: owner.id, name, phone: `+9198${rint(10000000, 99999999)}`, email: chance(0.6) ? `${name.split(" ")[0].toLowerCase()}${rint(1, 99)}@example.com` : null,
      source, sourceDetail: source === "meta" ? "Diwali 3 BHK campaign" : source === "google" ? "Search: 3 bhk " + l.locality.toLowerCase() : null,
      listingId: l.id, stage, score, scoreReason: score >= 70 ? "Budget matches, verified phone, wants a visit this week" : "Budget unclear, early in the search",
      budgetMin: l.priceInr ? round(l.priceInr * 0.85, 100000) : null, budgetMax: l.priceInr ? round(l.priceInr * 1.05, 100000) : null,
      city: l.city, locality: l.locality, note: pick([null, "Wants east facing, high floor.", "Will bring parents for the second visit.", "Comparing with a project in the next sector.", "Loan pre-approved."]),
      qualified: score >= 70, otpVerified: source === "meta" || chance(0.4), lastActivityAt: new Date(at.getTime() + rint(1, 72) * 36e5), createdAt: at, updatedAt: at,
    });
    acts.push({ id: id(), leadId: lid, actorId: null, kind: "created", body: `New lead from ${String(source).replace("portal_", "")}`, createdAt: at });
    const steps = ["new", "contacted", "site_visit", "negotiation", "booked"].indexOf(stage);
    if (steps >= 1 || stage === "lost") acts.push({ id: id(), leadId: lid, actorId: owner.id, kind: "call", body: "Called, discussed budget and timeline.", createdAt: new Date(at.getTime() + 2 * 36e5) });
    if (steps >= 2) acts.push({ id: id(), leadId: lid, actorId: owner.id, kind: "stage", body: "Moved to Site visit", meta: { from: "contacted", to: "site_visit" }, createdAt: new Date(at.getTime() + 30 * 36e5) });
    if (steps >= 3) acts.push({ id: id(), leadId: lid, actorId: owner.id, kind: "whatsapp", body: "Shared the cost sheet and payment plan on WhatsApp.", createdAt: new Date(at.getTime() + 50 * 36e5) });
    if (steps >= 4) acts.push({ id: id(), leadId: lid, actorId: owner.id, kind: "stage", body: "Booked 🎉", meta: { from: "negotiation", to: "booked" }, createdAt: new Date(at.getTime() + 90 * 36e5) });
    const src = sources.find((x) => x.source === source);
    if (src) src.leadCount++;
  }
  await insertMany(db, s.leads, leadRows, "leads");
  await insertMany(db, s.leadActivities, acts, "lead_activities");
  for (const src of sources) await db.update(s.leadSources).set({ leadCount: src.leadCount }).where(eq(s.leadSources.id, src.id));

  /* ------------------------------ campaigns ------------------------------ */
  const campRows: (typeof s.campaigns.$inferInsert)[] = [];
  ownerListings.slice(0, 2).forEach((l, i) => {
    const goal = i === 0 ? "Qualified buyers" : "Site visits";
    const budget = i === 0 ? 50000 : 30000;
    const plan = buildPlan({ purpose: l.purpose, priceInr: l.priceInr ?? 0, bhk: l.bhk, kind: l.kind, city: l.city, locality: l.locality, possession: l.possession, amenities: l.amenities as string[], goal,
      demand: { buyersHere: rint(12, 60), topLocalities: CITIES[l.city].locs.filter(([x]) => x !== l.locality).slice(0, 3).map(([locality]) => ({ locality, buyers: rint(5, 30) })), avgRate: rateOf(l.city, l.locality) }, pincodesFor });
    const fc = forecast(plan, budget, segmentOf(l.purpose, l.priceInr ?? 0));
    const live = i === 0;
    campRows.push({
      id: id(), ownerId: owner.id, listingId: l.id, name: `${l.title} | ${goal}`, goal, budgetInr: budget, days: 15, status: live ? "active" : "draft",
      plan: plan as never, forecast: fc as never, creatives: creativesFor(l) as never,
      spendInr: live ? Math.round(budget * 0.46) : 0, leadsCount: live ? Math.round(fc.leads * 0.48) : 0, qualifiedCount: live ? Math.round(fc.qualified * 0.45) : 0,
      launchedAt: live ? daysAgo(7) : null, createdAt: daysAgo(live ? 8 : 1),
    });
  });
  await insertMany(db, s.campaigns, campRows, "campaigns");

  /* ---------------------------- notifications ---------------------------- */
  const notes: (typeof s.notifications.$inferInsert)[] = [];
  const notify = (kind: typeof s.notifications.$inferInsert["kind"], title: string, body: string | null, actorId: string | null, targetType: string | null, targetId: string | null, d: number, unread: boolean) => {
    const at = daysAgo(d, 10);
    notes.push({ id: id(), userId: owner.id, kind, title, body, actorId, targetType, targetId, createdAt: at, readAt: unread ? null : new Date(at.getTime() + 36e5) });
  };
  inviters.forEach((p, i) => notify("connection", `${p.name} wants to connect`, p.headline ?? null, p.id, "profile", p.id, i, i < 3));
  leadRows.slice(0, 6).forEach((l, i) => notify("lead", `New lead: ${l.name}`, `${String(l.source).replace("portal_", "")} · score ${l.score}`, null, "lead", l.id, i, i < 3));
  convs.slice(0, 4).forEach((c, i) => notify("message", "New message", c.lastMessagePreview ?? null, c.lastSenderId ?? null, "conversation", c.id, i, i < 2));
  ownerListings.slice(0, 3).forEach((l, i) => notify("match", `Your listing matches ${rint(2, 6)} buyer requirements`, l.title, null, "listing", l.id, i + 2, false));
  notify("job", `${ownerJobs[0].title}: 3 new applicants`, ownerJobs[0].company, null, null, null, 1, true);
  notify("comment", `${pick(active).name} commented on your post`, "Great find! Sharing with my buyer.", null, null, null, 3, false);
  notify("system", "Your RERA verification is being reviewed", "We will let you know within one working day.", null, null, null, 6, false);
  await insertMany(db, s.notifications, notes, "notifications");

  /* ------------------------------ saved homes ------------------------------ */
  await insertMany(db, s.savedItems, sample(liveListings.filter((l) => l.ownerId !== owner.id), 6).map((l) => ({ userId: owner.id, itemType: "listing", itemId: l.id, createdAt: daysAgo(rint(0, 10)) })));

  /* --------------------------------- admin --------------------------------- */
  const verifs: (typeof s.verifications.$inferInsert)[] = sample(members.filter((m) => m.type !== "buyer"), 8).map((m, i) => {
    const score = rint(20, 92);
    return {
      id: id(), userId: m.id, kind: m.type === "dealer" && i % 2 === 0 ? "rera" : "kyc", documents: [], status: "pending",
      risk: score >= 70 ? "low" : score >= 45 ? "medium" : "high", riskScore: score,
      aiChecks: [{ label: "Name matches document", ok: score > 30 }, { label: "RERA number format is valid", ok: score > 45 }, { label: "Phone not used by another account", ok: true }, { label: "Photo is a real person", ok: score > 25 }],
      aiNote: score >= 70 ? "Everything checks out. Safe to approve." : score >= 45 ? "Name on the document is spelled differently. Ask for a second ID." : "RERA number not found in the state register. Likely invalid.",
      createdAt: daysAgo(rint(0, 4)),
    };
  });
  await insertMany(db, s.verifications, verifs, "verifications");
  const someposts = sample(postRows, 4);
  const reps: (typeof s.reports.$inferInsert)[] = [
    ...someposts.map((p, i) => ({ id: id(), reporterId: pick(active).id, targetType: "post", targetId: p.id, reason: pick(["Spam", "Misleading price", "Duplicate listing", "Abusive language"]), detail: i === 0 ? "Same post shared five times today." : null, status: "open" as const, aiConfidence: rint(40, 95), aiReason: pick(["Repeated text across many posts", "Price far below the locality average", "Contains a phone number in an image"]), createdAt: daysAgo(i) })),
    ...sample(liveListings, 2).map((l, i) => ({ id: id(), reporterId: pick(active).id, targetType: "listing", targetId: l.id, reason: "Property already sold", detail: null, status: "open" as const, aiConfidence: rint(30, 70), aiReason: "Listing has had no owner activity for 60 days", createdAt: daysAgo(i + 1) })),
  ];
  await insertMany(db, s.reports, reps, "reports");
  const audits: (typeof s.auditLog.$inferInsert)[] = [
    ["verification.approved", "user"], ["verification.rejected", "user"], ["member.suspended", "user"], ["content.hidden", "post"], ["verification.approved", "user"], ["member.reinstated", "user"], ["content.dismissed", "post"], ["verification.info", "user"],
  ].map(([action, targetType], i) => ({ id: id(), actorId: safety.id, action, targetType, targetId: targetType === "post" ? pick(postRows).id! : pick(members).id, meta: { demo: true }, createdAt: daysAgo(i, 12) }));
  await insertMany(db, s.auditLog, audits, "audit_log");

  /* ------------------------------ counters ------------------------------ */
  const everyone = [...members.map((m) => m.id), safety.id, owner.id];
  await pool.query(`update users u set
      connection_count = (select count(*) from connections c where c.user_id = u.id and c.status = 'accepted'),
      listing_count = (select count(*) from listings l where l.owner_id = u.id and l.status = 'active')
    where u.id = any($1)`, [everyone]);

  // Record what was created, so the next run can remove it exactly.
  for (const [tbl, ids] of Object.entries(created)) {
    for (let i = 0; i < ids.length; i += 1000) {
      const slice = ids.slice(i, i + 1000);
      await pool.query(`insert into _demo_seed (tbl, id) select $1, unnest($2::text[]) on conflict do nothing`, [tbl, slice]);
    }
  }
  await pool.query("analyze");
  console.timeEnd("seed");
  console.log(Object.entries(created).map(([t, ids]) => `${t}: ${ids.length}`).join(", "));
  console.log(`wired to ${owner.email} (${owner.id})`);
  await pool.end();
}

/* ------------------------------ the owner ------------------------------ */

async function ensureOwner(db: Db) {
  const email = (process.env.SEED_OWNER_EMAIL ?? "contact@topsqill.com").trim().toLowerCase();
  const makeAdmin = process.env.SEED_OWNER_ADMIN === "true";
  const [existing] = await db.select().from(s.users).where(and(sql`lower(${s.users.email}) = ${email}`, eq(s.users.emailVerified, true))).limit(1);
  if (existing) {
    if (makeAdmin && !existing.isAdmin) await db.update(s.users).set({ isAdmin: true }).where(eq(s.users.id, existing.id));
    return existing;
  }
  // Not a member yet: create the account, already verified, so signing in with
  // this address and an emailed code opens it.
  const row = {
    id: id(), email, emailVerified: true, phone: null, name: "Topsqill Team", type: "dealer" as const, status: "active" as const,
    isAdmin: makeAdmin, city: "Gurgaon", localities: ["Golf Course Road", "Sector 65"], agency: "Topsqill Realty",
    headline: "Property consultant on Golf Course Road and Sector 65, Gurgaon", yearsExperience: 8, kycVerified: true,
  };
  await db.insert(s.users).values(row);
  return (await db.select().from(s.users).where(eq(s.users.id, row.id)).limit(1))[0];
}

/* ------------------------------ reset ------------------------------ */

async function reset(pool: Pool, db: Db) {
  const ids = async (tbl: string) => (await pool.query<{ id: string }>(`select id from _demo_seed where tbl = $1`, [tbl])).rows.map((r) => r.id);
  const [users, listings, posts, reqs, convs, leads, jobs, sources] = await Promise.all(
    ["users", "listings", "posts", "requirements", "conversations", "leads", "jobs", "lead_sources"].map(ids));
  if (!users.length && !listings.length && !leads.length) return;
  const inn = <T,>(col: T, list: string[]) => (list.length ? inArray(col as never, list) : sql`false`);

  // Conversations with demo members, including ones real members started.
  const allConvs = [...new Set([...convs, ...(users.length ? (await db.select({ id: s.conversations.id }).from(s.conversations)
    .where(or(inn(s.conversations.aId, users), inn(s.conversations.bId, users)))).map((r) => r.id) : [])])];

  await db.transaction(async (tx) => {
    await tx.delete(s.postLikes).where(or(inn(s.postLikes.postId, posts), inn(s.postLikes.userId, users)));
    await tx.delete(s.postComments).where(or(inn(s.postComments.postId, posts), inn(s.postComments.authorId, users), inn(s.postComments.id, await ids("post_comments"))));
    await tx.delete(s.posts).where(or(inn(s.posts.id, posts), inn(s.posts.authorId, users)));
    await tx.delete(s.requirementMatches).where(or(inn(s.requirementMatches.requirementId, reqs), inn(s.requirementMatches.listingId, listings)));
    await tx.delete(s.requirements).where(inn(s.requirements.id, reqs));
    await tx.delete(s.savedItems).where(or(inn(s.savedItems.userId, users), inn(s.savedItems.itemId, listings)));
    await tx.delete(s.listingMedia).where(inn(s.listingMedia.listingId, listings));
    await tx.delete(s.media).where(inn(s.media.id, await ids("media")));
    await tx.delete(s.leadActivities).where(inn(s.leadActivities.leadId, leads));
    await tx.delete(s.leads).where(inn(s.leads.id, leads));
    await tx.delete(s.ingestEvents).where(inn(s.ingestEvents.sourceId, sources));
    await tx.delete(s.leadSources).where(inn(s.leadSources.id, sources));
    await tx.delete(s.campaigns).where(inn(s.campaigns.id, await ids("campaigns")));
    await tx.delete(s.listings).where(inn(s.listings.id, listings));
    await tx.delete(s.projects).where(inn(s.projects.id, await ids("projects")));
    await tx.delete(s.jobApplications).where(or(inn(s.jobApplications.jobId, jobs), inn(s.jobApplications.userId, users)));
    await tx.delete(s.jobs).where(inn(s.jobs.id, jobs));
    await tx.delete(s.messages).where(inn(s.messages.conversationId, allConvs));
    await tx.delete(s.conversations).where(inn(s.conversations.id, allConvs));
    await tx.delete(s.notifications).where(or(inn(s.notifications.id, await ids("notifications")), inn(s.notifications.actorId, users)));
    await tx.delete(s.connections).where(or(inn(s.connections.userId, users), inn(s.connections.peerId, users)));
    await tx.delete(s.follows).where(or(inn(s.follows.followerId, users), inn(s.follows.targetId, users)));
    await tx.delete(s.verifications).where(or(inn(s.verifications.id, await ids("verifications")), inn(s.verifications.userId, users)));
    await tx.delete(s.reports).where(or(inn(s.reports.id, await ids("reports")), inn(s.reports.reporterId, users)));
    await tx.delete(s.auditLog).where(inn(s.auditLog.id, await ids("audit_log")));
    await tx.delete(s.users).where(inn(s.users.id, users));
  });
  await pool.query("truncate _demo_seed");
  // Real members who were connected to demo members get their counts corrected.
  await pool.query(`update users u set
      connection_count = (select count(*) from connections c where c.user_id = u.id and c.status = 'accepted'),
      listing_count = (select count(*) from listings l where l.owner_id = u.id and l.status = 'active')`);
  console.log("previous demo data removed");
}

/* ------------------------------ copy ------------------------------ */

function reraFor(city: string) {
  const n = rint(1000, 9999);
  switch (city) {
    case "Gurgaon": return `RC/HARERA/GGM/${rint(2019, 2025)}/${n}`;
    case "Noida": return `UPRERAAGT${rint(10000, 19999)}`;
    case "Mumbai": case "Pune": return `A51${rint(1000, 9999)}${rint(10000, 99999)}`;
    case "Bengaluru": return `PRM/KA/RERA/1251/${rint(300, 499)}/AG/${rint(180000, 250000)}`;
    case "Hyderabad": return `A02500${rint(1000, 9999)}`;
    default: return `DLRERA${rint(2019, 2025)}A${n}`;
  }
}
function headlineFor(type: string, loc: string, city: string, agency: string | null, years: number | null) {
  if (type === "dealer") return `${pick(["Property consultant", "Real estate advisor", "Resale and rental specialist", "Luxury homes specialist"])} · ${loc}, ${city}${agency ? ` · ${agency}` : ""}`.slice(0, 160);
  if (type === "builder") return `${pick(["Developer of premium residences", "Building homes", "Residential and commercial developer"])} in ${city}${years ? ` · ${years} years` : ""}`;
  if (type === "seller") return `Selling my home in ${loc}, ${city}`;
  return `Looking for a ${pick(["3 BHK", "2 BHK", "4 BHK", "home"])} in ${loc}, ${city}`;
}
function aboutFor(type: string, locs: string[], city: string, agency: string | null, years: number | null) {
  if (type === "dealer") return `I help families and investors buy, sell and rent in ${locs.join(", ")}, ${city}. ${years ?? 5}+ years in the market${agency ? ` with ${agency}` : ""}, ${rint(80, 600)}+ deals closed. Verified listings only, honest advice, and I handle the paperwork end to end.`;
  if (type === "builder") return `${agency ?? "We"} build thoughtfully designed homes in ${city}, with on-time delivery and transparent pricing. Ask us about current launches in ${locs[0]}.`;
  if (type === "seller") return `Owner selling directly. The home is well kept and ready to move in. Brokers with genuine buyers are welcome.`;
  return `First-time buyer, looking in ${locs.join(" or ")}. Prefer ready to move, close to the metro, and a good school nearby.`;
}
function descriptionFor(kind: string, bhk: number | null, loc: string, city: string, area: number, facing: string, amenities: string[], possession: string, purpose: string) {
  const what = bhk ? `${bhk} BHK ${kind.toLowerCase()}` : kind.toLowerCase();
  return `A ${facing.toLowerCase()} ${what} in ${loc}, ${city}, with ${area.toLocaleString("en-IN")} sq ft of well-planned space. ${possession === "Ready to move" ? "Ready to move in" : "Under construction with a RERA-committed possession date"}, in a gated society with ${amenities.slice(0, 3).join(", ").toLowerCase()}. Close to schools, hospitals and the expressway. ${purpose === "rent" ? "Available for families and corporate leases." : "Clear title and bank-approved for home loans."}`;
}
function creativesFor(l: { title: string; bhk?: number | null; locality: string; city: string; priceInr?: number | null; possession?: string | null; amenities?: unknown; areaSqft?: number | null; furnishing?: string | null }) {
  const bhk = l.bhk ? `${l.bhk} BHK` : "";
  const price = !l.priceInr ? "price on request" : l.priceInr >= 1e7 ? `₹${(l.priceInr / 1e7).toFixed(2).replace(/\.?0+$/, "")} Cr` : `₹${Math.round(l.priceInr / 1e5)} L`;
  const am = ((l.amenities as string[]) ?? []).slice(0, 3);
  return {
    headlines: [`${bhk} in ${l.locality} at ${price}`.trim(), "Your family's next home is here", `${l.possession ?? "Ready"}: ${l.locality}`],
    primaryTexts: [`🏡 ${l.title}. ${l.possession?.toLowerCase() ?? ""}, with ${am.join(", ").toLowerCase()}. ${(l.areaSqft ?? 0).toLocaleString("en-IN")} sq ft at ${price}. Tap to book a site visit this weekend.`, `Looking in ${l.locality}? This ${bhk} has everything on your list. Get the floor plan and price sheet in one tap.`],
    hinglish: `${l.locality} mein apna ${bhk} ghar, ${price} mein 🏡 Site visit is weekend book karein!`,
    carousel: [{ title: bhk || "Home", sub: `${(l.areaSqft ?? 0).toLocaleString("en-IN")} sq ft` }, { title: "Living spaces", sub: l.furnishing ?? "Airy and well-kept" }, { title: "Amenities", sub: am.join(", ") }, { title: "Location", sub: `${l.locality}, ${l.city}` }, { title: price, sub: "Book a site visit" }],
    reel: [{ caption: `Found it: ${bhk} in ${l.locality}`, sub: l.title }, { caption: "Light-filled rooms", sub: l.furnishing ?? "" }, { caption: am[0] ?? "Great amenities", sub: am.slice(1).join(" | ") }, { caption: `Close to everything in ${l.city}`, sub: "Schools, hospitals, metro" }, { caption: price, sub: "Book your site visit today" }],
    googleAd: { headlines: [`${bhk} in ${l.locality}`.trim(), `${l.possession ?? "Ready to move"} | ${price}`, "Verified listing, clear title", "Book a site visit today"], descriptions: [`${bhk} in ${l.locality}, ${l.city}. ${am.slice(0, 2).join(", ")}. Get the price sheet now.`, "Talk to a verified expert. Free site visit and home loan help."] },
    whatsappTemplate: `Hi {{1}}, thanks for your interest in ${l.title} (${price}). Here is the brochure and floor plan 📄 Would Saturday or Sunday suit you for a site visit?`,
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
