import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/db.module";
import { posts } from "../db/schema";
import { newId } from "../common/ids";

type Activity = { authorId: string; kind: "listing" | "requirement" | "job"; refId: string; body: string; mediaIds?: string[] };

/**
 * Puts a new listing, requirement or job on the wall as a post by its owner,
 * once: relisting, re-approving or editing never posts it again. The wall
 * reads from the database, so it shows straight away. A failure here never
 * stops the listing (or requirement, or job) itself from being saved.
 */
export async function postActivity(db: Database, a: Activity) {
  try {
    const [have] = await db.select({ id: posts.id }).from(posts)
      .where(and(eq(posts.kind, a.kind), eq(posts.refId, a.refId), isNull(posts.repostOfId))).limit(1);
    if (have) return null;
    const [row] = await db.insert(posts).values({
      id: newId(), authorId: a.authorId, kind: a.kind, refId: a.refId, body: a.body.slice(0, 3000), mediaIds: (a.mediaIds ?? []).slice(0, 4),
    }).returning();
    return row;
  } catch { return null; }
}

const place = (locality?: string | null, city?: string | null) => [locality, city].filter(Boolean).join(", ");

export function listingActivityText(l: { bhk?: number | null; kind: string; purpose: string; locality: string; city: string; title: string }) {
  return `🏠 Just listed${l.purpose === "rent" ? " for rent" : ""}: ${l.bhk ? `${l.bhk} BHK ` : ""}${l.kind} in ${place(l.locality, l.city)}\n${l.title}`;
}
export function requirementActivityText(r: { bhk?: number | null; kind: string; purpose: string; localities?: string[] | null; city: string; note?: string | null }) {
  const where = r.localities?.length ? `${r.localities.slice(0, 3).join(" / ")}, ${r.city}` : r.city;
  return `🔎 Looking to ${r.purpose === "rent" ? "rent" : "buy"}: ${r.bhk ? `${r.bhk} BHK ` : ""}${r.kind} in ${where}${r.note ? `\n${r.note.slice(0, 280)}` : ""}\nHave a match? Reply here or send it from your listings.`;
}
export function jobActivityText(j: { title: string; company: string; city: string; locality?: string | null; openings?: number | null }) {
  return `💼 Hiring: ${j.title} at ${j.company}, ${place(j.locality, j.city)}${j.openings && j.openings > 1 ? ` · ${j.openings} openings` : ""}`;
}
