import { Injectable, Inject, NotFoundException, ForbiddenException } from "@nestjs/common";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { leads, leadActivities, listings, users } from "../db/schema";
import { NotificationsService } from "../notifications/notifications.service";
import { CacheService } from "../redis/redis.module";
import { newId } from "../common/ids";
import { normalisePhone } from "../auth/phone";
import { scoreLead } from "./scoring";

const STAGES = ["new", "contacted", "site_visit", "negotiation", "booked", "lost"] as const;
export type Stage = (typeof STAGES)[number];

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly notifs: NotificationsService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Creates a lead, or merges into an existing one from the same phone number.
   * Without this, one buyer enquiring from three portals becomes three leads and
   * three phone calls, which is the fastest way to lose them.
   */
  async capture(ownerId: string, input: {
    name?: string; phone?: string; email?: string; source?: string; sourceDetail?: string;
    listingId?: string; city?: string; locality?: string; budgetMin?: number; budgetMax?: number;
    timeline?: string; note?: string; otpVerified?: boolean; externalId?: string; assigneeId?: string;
  }) {
    const phone = normalisePhone(input.phone ?? "") ?? undefined;

    let listingPrice: number | undefined;
    if (input.listingId) {
      const [l] = await this.read.select({ priceInr: listings.priceInr }).from(listings).where(eq(listings.id, input.listingId)).limit(1);
      listingPrice = l?.priceInr ?? undefined;
    }
    const scored = scoreLead({ ...input, phone, listingPrice });

    // Same owner, same phone, seen in the last 90 days: treat it as a re-enquiry.
    if (phone) {
      const [existing] = await this.read.select().from(leads)
        .where(and(eq(leads.ownerId, ownerId), eq(leads.phone, phone),
          gte(leads.createdAt, new Date(Date.now() - 90 * 86400_000))))
        .orderBy(desc(leads.createdAt)).limit(1);
      if (existing) {
        await this.db.update(leads).set({
          score: Math.max(existing.score, scored.score),
          qualified: existing.qualified || scored.qualified,
          name: existing.name === "Unknown" && input.name ? input.name : existing.name,
          email: existing.email ?? input.email ?? null,
          listingId: existing.listingId ?? input.listingId ?? null,
          stage: existing.stage === "lost" ? "new" : existing.stage,
          lastActivityAt: new Date(), updatedAt: new Date(),
        }).where(eq(leads.id, existing.id));
        await this.addActivity(existing.id, null, "system", `Enquired again via ${input.source ?? "another source"}`, { source: input.source, listingId: input.listingId });
        await this.notifs.create({
          userId: ownerId, kind: "lead", title: `${existing.name} enquired again`,
          body: `From ${input.source ?? "another source"}`, targetType: "lead", targetId: existing.id,
        });
        return { lead: existing, duplicate: true };
      }
    }

    const id = newId();
    const [row] = await this.db.insert(leads).values({
      id, ownerId, assigneeId: input.assigneeId ?? ownerId,
      name: input.name?.trim() || "Unknown", phone: phone ?? null, email: input.email ?? null,
      source: (input.source as never) ?? "other", sourceDetail: input.sourceDetail,
      listingId: input.listingId ?? null, city: input.city, locality: input.locality,
      budgetMin: input.budgetMin, budgetMax: input.budgetMax, note: input.note,
      otpVerified: !!input.otpVerified, externalId: input.externalId,
      score: scored.score, scoreReason: scored.reason, qualified: scored.qualified,
      lastActivityAt: new Date(),
    }).returning();

    await this.addActivity(id, null, "system", `Lead captured from ${input.source ?? "an unknown source"}`, { score: scored.score });
    if (input.listingId) await this.db.update(listings).set({ leadCount: sql`${listings.leadCount} + 1` }).where(eq(listings.id, input.listingId));
    await this.notifs.create({
      userId: input.assigneeId ?? ownerId, kind: "lead",
      title: scored.qualified ? `Qualified lead: ${row.name}` : `New lead: ${row.name}`,
      body: `${input.source ?? "Enquiry"}${input.locality ? " | " + input.locality : ""} | score ${scored.score}`,
      targetType: "lead", targetId: id,
    });
    return { lead: row, duplicate: false };
  }

  /** The CRM board: all stages in one query, grouped in memory. */
  async board(ownerId: string, assigneeId?: string) {
    const where = [eq(leads.ownerId, ownerId)];
    if (assigneeId) where.push(eq(leads.assigneeId, assigneeId));
    const rows = await this.read.select({
      id: leads.id, name: leads.name, phone: leads.phone, stage: leads.stage, score: leads.score,
      qualified: leads.qualified, source: leads.source, listingId: leads.listingId, locality: leads.locality,
      budgetMax: leads.budgetMax, note: leads.note, createdAt: leads.createdAt, lastActivityAt: leads.lastActivityAt,
      assigneeId: leads.assigneeId,
    }).from(leads).where(and(...where)).orderBy(desc(leads.createdAt)).limit(500);

    const listingIds = [...new Set(rows.map((r) => r.listingId).filter(Boolean))] as string[];
    const titles = listingIds.length
      ? await this.read.select({ id: listings.id, title: listings.title }).from(listings).where(inArray(listings.id, listingIds))
      : [];
    const titleById = new Map(titles.map((t) => [t.id, t.title]));

    const columns: Record<string, unknown[]> = Object.fromEntries(STAGES.map((s) => [s, []]));
    for (const r of rows) columns[r.stage].push({ ...r, listingTitle: r.listingId ? titleById.get(r.listingId) ?? null : null });
    return { columns, total: rows.length };
  }

  async stats(ownerId: string) {
    return this.cache.wrap(`leadstats:${ownerId}`, 60, async () => {
      const res = await this.read.execute(sql`
        select
          count(*) filter (where created_at > now() - interval '7 days')::int as "last7Days",
          count(*) filter (where qualified)::int                              as "qualified",
          count(*) filter (where stage = 'booked')::int                       as "booked",
          coalesce(round(avg(score)),0)::int                                  as "averageScore",
          count(*)::int                                                       as "total"
        from leads where owner_id = ${ownerId}`);
      const row = (Array.isArray(res) ? res[0] : (res as any).rows[0]) ?? {};
      const bySource = await this.read.select({ source: leads.source, n: sql<number>`count(*)::int` })
        .from(leads).where(eq(leads.ownerId, ownerId)).groupBy(leads.source).orderBy(desc(sql`count(*)`));
      return { ...row, bySource };
    });
  }

  async get(userId: string, id: string) {
    const [row] = await this.read.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!row) throw new NotFoundException("That lead could not be found.");
    if (row.ownerId !== userId && row.assigneeId !== userId) throw new ForbiddenException("This lead isn’t yours.");
    const activities = await this.read.select().from(leadActivities)
      .where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.createdAt)).limit(50);
    return { ...row, activities };
  }

  async setStage(userId: string, id: string, stage: Stage) {
    const lead = await this.get(userId, id);
    await this.db.update(leads).set({ stage, lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, id));
    await this.addActivity(id, userId, "stage", `Moved from ${lead.stage.replace("_", " ")} to ${stage.replace("_", " ")}`);
    await this.cache.invalidate(`leadstats:${lead.ownerId}`);
    return { ok: true, stage };
  }

  async assign(userId: string, id: string, assigneeId: string) {
    const lead = await this.get(userId, id);
    if (lead.ownerId !== userId) throw new ForbiddenException("Only the lead owner can reassign it.");
    await this.db.update(leads).set({ assigneeId, updatedAt: new Date() }).where(eq(leads.id, id));
    const [who] = await this.read.select({ name: users.name }).from(users).where(eq(users.id, assigneeId)).limit(1);
    await this.addActivity(id, userId, "system", `Assigned to ${who?.name ?? "a colleague"}`);
    await this.notifs.create({ userId: assigneeId, kind: "lead", title: `A lead was assigned to you: ${lead.name}`, targetType: "lead", targetId: id });
    return { ok: true };
  }

  async addActivity(leadId: string, actorId: string | null, kind: string, body?: string, meta?: Record<string, unknown>) {
    const [row] = await this.db.insert(leadActivities).values({ id: newId(), leadId, actorId, kind, body, meta }).returning();
    await this.db.update(leads).set({ lastActivityAt: new Date() }).where(eq(leads.id, leadId));
    return row;
  }

  async note(userId: string, id: string, body: string, kind = "note") {
    await this.get(userId, id);
    return this.addActivity(id, userId, kind, body);
  }
}
