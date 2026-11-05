import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql, inArray, gte } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, listings, posts, postComments, reports, verifications, auditLog, media } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { newId } from "../common/ids";

type Decision = "approved" | "rejected" | "info";

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
  ) {}

  /** Numbers for the admin overview. One round trip, not six. */
  async overview() {
    const res = await this.read.execute(sql`
      select
        (select count(*) from users where status = 'active')::int                       as "activeMembers",
        (select count(*) from users where created_at > now() - interval '7 days')::int  as "newThisWeek",
        (select count(*) from verifications where status in ('pending','info'))::int    as "pendingApprovals",
        (select count(*) from reports where status = 'open')::int                       as "openReports",
        (select count(*) from listings where status = 'active' and hidden = false)::int as "activeListings",
        (select count(*) from posts where created_at > now() - interval '1 day')::int   as "postsToday",
        (select count(*) from media where status in ('uploading','processing'))::int    as "mediaProcessing"`);
    const row = (Array.isArray(res) ? res[0] : (res as { rows: unknown[] }).rows[0]) as Record<string, number>;

    const signups = await this.read.execute(sql`
      select to_char(d::date, 'YYYY-MM-DD') as day, count(u.id)::int as count
      from generate_series(now() - interval '13 days', now(), interval '1 day') d
      left join users u on u.created_at::date = d::date
      group by d order by d`);
    return { ...row, signups: Array.isArray(signups) ? signups : (signups as { rows: unknown[] }).rows };
  }

  /* ----------------------------- approvals ----------------------------- */

  async verificationQueue(status: string = "pending", limit = 30) {
    const rows = await this.read.select({
      id: verifications.id, kind: verifications.kind, status: verifications.status,
      risk: verifications.risk, riskScore: verifications.riskScore, aiChecks: verifications.aiChecks,
      aiNote: verifications.aiNote, documents: verifications.documents, createdAt: verifications.createdAt,
      userId: users.id, name: users.name, type: users.type, city: users.city, phone: users.phone,
      email: users.email, reraNumber: users.reraNumber, agency: users.agency,
    }).from(verifications).innerJoin(users, eq(users.id, verifications.userId))
      .where(eq(verifications.status, status))
      .orderBy(verifications.createdAt).limit(Math.min(limit, 100));
    return { items: rows };
  }

  /**
   * Risk checks that need no AI: document completeness, RERA format, duplicate
   * phone numbers and disposable email domains. The AI review builds on these.
   */
  async riskCheck(verificationId: string) {
    const [v] = await this.read.select().from(verifications).where(eq(verifications.id, verificationId)).limit(1);
    if (!v) throw new NotFoundException("That request could not be found.");
    const [u] = await this.read.select().from(users).where(eq(users.id, v.userId)).limit(1);

    const checks: { label: string; ok: boolean }[] = [];
    let score = 8;

    const docs = (v.documents ?? []).map((d) => String(d).toLowerCase());
    const hasId = docs.some((d) => d.includes("pan")) && docs.some((d) => d.includes("aadhaar"));
    checks.push({ label: "PAN and Aadhaar uploaded", ok: hasId });
    if (!hasId) score += 25;

    if (v.kind !== "kyc") {
      const rera = u?.reraNumber ?? "";
      const reraOk = /^[A-Z]{2,}[A-Z0-9/-]*\d{3,}/i.test(rera);
      checks.push({ label: "RERA number format is valid", ok: reraOk });
      if (!reraOk) score += 30;
    }

    const dupRes = await this.read.execute(sql`
      select count(*)::int as n from users where phone = ${u?.phone ?? ""} and id <> ${v.userId}`);
    const dup = Number((Array.isArray(dupRes) ? dupRes[0] : (dupRes as any).rows[0])?.n ?? 0);
    checks.push({ label: "Phone not already used on Topsqill.ai", ok: dup === 0 });
    if (dup) score += 25;

    const email = (u?.email ?? "").toLowerCase();
    const disposable = /tempmail|mailinator|guerrillamail|10minutemail|yopmail/.test(email);
    checks.push({ label: "Email domain looks genuine", ok: !disposable });
    if (disposable) score += 15;

    score = Math.min(97, score);
    const risk = score >= 55 ? "high" : score >= 30 ? "medium" : "low";
    const note = risk === "low" ? "All key checks pass. Safe to approve."
      : dup ? "This phone number is already registered. Confirm identity before approving."
      : !hasId ? "Documents are missing. Ask the applicant to upload them."
      : "Some checks need attention before approving.";

    await this.db.update(verifications).set({ risk, riskScore: score, aiChecks: checks, aiNote: note })
      .where(eq(verifications.id, verificationId));
    return { risk, score, checks, note };
  }

  async decide(adminId: string, verificationId: string, decision: Decision, note?: string) {
    const [v] = await this.db.update(verifications)
      .set({ status: decision, note, reviewedBy: adminId, reviewedAt: new Date() })
      .where(eq(verifications.id, verificationId)).returning();
    if (!v) throw new NotFoundException("That request could not be found.");

    if (decision === "approved") {
      const patch = v.kind === "rera" ? { reraVerified: true, status: "active" as const } : { kycVerified: true, status: "active" as const };
      await this.db.update(users).set(patch).where(eq(users.id, v.userId));
      await this.cache.invalidate(`profile:${v.userId}`);
    }
    await this.audit(adminId, `verification.${decision}`, "user", v.userId, { kind: v.kind });
    return v;
  }

  /* ----------------------------- moderation ----------------------------- */

  async reportQueue(status: "open" | "actioned" | "dismissed" = "open", limit = 50) {
    const rows = await this.read.select().from(reports)
      .where(eq(reports.status, status)).orderBy(desc(reports.createdAt)).limit(Math.min(limit, 100));
    if (!rows.length) return { items: [] };

    // Load the reported content itself, grouped by type: two queries, not one per report.
    const postIds = rows.filter((r) => r.targetType === "post").map((r) => r.targetId);
    const listingIds = rows.filter((r) => r.targetType === "listing").map((r) => r.targetId);
    const [postRows, listingRows] = await Promise.all([
      postIds.length ? this.read.select({ id: posts.id, body: posts.body, authorId: posts.authorId, hidden: posts.hidden, createdAt: posts.createdAt }).from(posts).where(inArray(posts.id, postIds)) : [],
      listingIds.length ? this.read.select({ id: listings.id, title: listings.title, ownerId: listings.ownerId, hidden: listings.hidden, priceInr: listings.priceInr }).from(listings).where(inArray(listings.id, listingIds)) : [],
    ]);
    const byId = new Map<string, unknown>([...postRows, ...listingRows].map((r) => [r.id, r]));
    return { items: rows.map((r) => ({ ...r, target: byId.get(r.targetId) ?? null })) };
  }

  async createReport(reporterId: string | null, input: { targetType: string; targetId: string; reason: string; detail?: string; aiConfidence?: number; aiReason?: string }) {
    const [row] = await this.db.insert(reports).values({ id: newId(), reporterId, ...input }).returning();
    return row;
  }

  /** Hide or restore a post, comment or listing. Nothing is ever deleted outright. */
  async moderate(adminId: string, targetType: string, targetId: string, hide: boolean, reason?: string) {
    if (targetType === "post") await this.db.update(posts).set({ hidden: hide }).where(eq(posts.id, targetId));
    else if (targetType === "comment") await this.db.update(postComments).set({ hidden: hide }).where(eq(postComments.id, targetId));
    else if (targetType === "listing") await this.db.update(listings).set({ hidden: hide }).where(eq(listings.id, targetId));
    else throw new NotFoundException("Unknown content type.");

    await this.db.update(reports).set({ status: hide ? "actioned" : "dismissed", reviewedBy: adminId, reviewedAt: new Date() })
      .where(and(eq(reports.targetType, targetType), eq(reports.targetId, targetId), eq(reports.status, "open")));
    if (targetType === "listing") await this.cache.invalidate(`listing:${targetId}`);
    await this.audit(adminId, hide ? "content.hidden" : "content.restored", targetType, targetId, { reason });
    return { ok: true, hidden: hide };
  }

  /* ------------------------------- members ------------------------------- */

  async members(q: { search?: string; type?: string; status?: string; limit?: number; offset?: number }) {
    const where = [];
    if (q.type) where.push(eq(users.type, q.type as never));
    if (q.status) where.push(eq(users.status, q.status as never));
    if (q.search) where.push(sql`(${users.name} ilike ${"%" + q.search + "%"} or ${users.phone} like ${"%" + q.search + "%"} or ${users.agency} ilike ${"%" + q.search + "%"})`);
    const rows = await this.read.select({
      id: users.id, name: users.name, type: users.type, status: users.status, city: users.city,
      phone: users.phone, kycVerified: users.kycVerified, reraVerified: users.reraVerified,
      listingCount: users.listingCount, connectionCount: users.connectionCount, createdAt: users.createdAt,
    }).from(users).where(where.length ? and(...where) : undefined)
      .orderBy(desc(users.createdAt)).limit(Math.min(q.limit ?? 50, 100)).offset(q.offset ?? 0);
    return { items: rows };
  }

  async setMemberStatus(adminId: string, userId: string, status: "active" | "suspended" | "removed", reason?: string) {
    const [row] = await this.db.update(users).set({ status, suspendedReason: reason ?? null, updatedAt: new Date() })
      .where(eq(users.id, userId)).returning();
    if (!row) throw new NotFoundException("That member could not be found.");
    // A suspended member's listings disappear from search straight away.
    await this.db.update(listings).set({ hidden: status !== "active" }).where(eq(listings.ownerId, userId));
    await this.cache.invalidate(`profile:${userId}`);
    await this.audit(adminId, `member.${status}`, "user", userId, { reason });
    return row;
  }

  async setVerified(adminId: string, userId: string, field: "kyc" | "rera", value: boolean) {
    await this.db.update(users).set(field === "kyc" ? { kycVerified: value } : { reraVerified: value }).where(eq(users.id, userId));
    await this.cache.invalidate(`profile:${userId}`);
    await this.audit(adminId, `member.${field}.${value ? "verified" : "unverified"}`, "user", userId);
    return { ok: true };
  }

  /* -------------------------------- audit -------------------------------- */

  async audit(actorId: string | null, action: string, targetType?: string, targetId?: string, meta?: Record<string, unknown>) {
    await this.db.insert(auditLog).values({ id: newId(), actorId, action, targetType, targetId, meta });
  }

  async auditTrail(limit = 100) {
    const rows = await this.read.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(Math.min(limit, 200));
    return { items: rows };
  }
}
