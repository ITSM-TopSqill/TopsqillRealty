/**
 * Seeds realistic demo data: 1,000 members, listings, connections and posts.
 * Everything is inserted in batches, so the whole seed takes seconds, not minutes.
 */
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "../src/common/env";
import { poolConfig } from "../src/db/pool-config";

const CITIES: Record<string, string[]> = {
  Gurgaon: ["Golf Course Road", "Sector 65", "Dwarka Expressway", "Sohna Road", "DLF Phase 5"],
  Noida: ["Sector 150", "Sector 75", "Sector 137", "Sector 128"],
  Delhi: ["Dwarka", "Vasant Kunj", "Saket", "Greater Kailash"],
  Mumbai: ["Powai", "Andheri West", "Thane West", "Chembur"],
  Bengaluru: ["Whitefield", "Sarjapur Road", "HSR Layout", "Hebbal"],
  Pune: ["Hinjewadi", "Baner", "Kharadi", "Wakad"],
  Hyderabad: ["Gachibowli", "Kondapur", "Kokapet", "Madhapur"],
};
const FIRST = ["Aarav", "Riya", "Vikram", "Ananya", "Rohit", "Neha", "Karan", "Priya", "Imran", "Simran", "Rahul", "Meera"];
const LAST = ["Sharma", "Verma", "Mehta", "Kapoor", "Singh", "Iyer", "Nair", "Reddy", "Patel", "Khan", "Gill", "Bose"];
const TYPES = ["dealer", "dealer", "buyer", "seller", "builder"] as const;
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const rint = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

async function main() {
  const pool = new Pool(poolConfig(env.DATABASE_URL, { max: 4 }));
  console.time("seed");

  const users: any[][] = [];
  for (let i = 0; i < 1000; i++) {
    const city = pick(Object.keys(CITIES));
    const locs = CITIES[city].slice(0, 2);
    const type = pick(TYPES);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    users.push([uuidv7(), `+91${rint(6000000000, 9999999999)}`, name, type, "active",
      city, JSON.stringify(locs), `${type === "dealer" ? "Property consultant" : type === "builder" ? "Developer" : "Looking for a home"} in ${locs[0]}, ${city}`,
    type === "dealer", rint(1, 20)]);
  }
  await batchInsert(pool, `insert into users (id, phone, name, type, status, city, localities, headline, rera_verified, years_experience) values %L on conflict do nothing`, users);

  const ids = (await pool.query<{ id: string; city: string; localities: string[] }>("select id, city, localities from users limit 1000")).rows;

  const listings: any[][] = [];
  for (const u of ids) {
    for (let k = 0; k < rint(0, 3); k++) {
      const locality = (u.localities as string[])[0] ?? "Sector 1";
      const bhk = rint(2, 4);
      const area = bhk * 560 + rint(50, 400);
      listings.push([uuidv7(), u.id, "active", `${bhk} BHK apartment in ${locality}`, "sale", "Apartment",
        bhk, area, area * rint(6000, 22000), u.city, locality, "Ready to move", JSON.stringify(["Clubhouse", "Power backup"]), JSON.stringify([]), new Date()]);
    }
  }
  await batchInsert(pool, `insert into listings (id, owner_id, status, title, purpose, kind, bhk, area_sqft, price_inr, city, locality, possession, amenities, usps, published_at) values %L on conflict do nothing`, listings);

  const conns: any[][] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let k = 0; k < 8; k++) {
      const j = rint(0, ids.length - 1);
      if (i === j) continue;
      conns.push([ids[i].id, ids[j].id, "accepted", ids[i].id]);
      conns.push([ids[j].id, ids[i].id, "accepted", ids[i].id]);
    }
  }
  await batchInsert(pool, `insert into connections (user_id, peer_id, status, requested_by) values %L on conflict do nothing`, conns);
  await pool.query(`update users u set connection_count = (select count(*) from connections c where c.user_id = u.id and c.status='accepted')`);

  const posts: any[][] = [];
  for (const u of ids.slice(0, 400)) {
    posts.push([uuidv7(), u.id, "update", `New opportunities in ${(u.localities as string[])[0] ?? u.city}. Message me for details.`, rint(0, 200), rint(0, 30)]);
  }
  await batchInsert(pool, `insert into posts (id, author_id, kind, body, like_count, comment_count) values %L on conflict do nothing`, posts);

  await pool.query("analyze");   // fresh statistics so the planner picks the right indexes
  console.timeEnd("seed");
  console.log(`seeded ${users.length} users, ${listings.length} listings, ${conns.length} connections, ${posts.length} posts`);
  await pool.end();
}

/** Inserts in chunks of 1,000 rows: one statement instead of thousands. */
async function batchInsert(pool: Pool, template: string, rows: any[][], chunk = 1000) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params: any[] = [];
    const values = slice.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(",")})`).join(",");
    await pool.query(template.replace("%L", values), params);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
