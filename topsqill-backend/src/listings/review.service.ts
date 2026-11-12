import { Injectable, Inject, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, inArray, sql, ne } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { listings, listingMedia, listingReviews, media, users, appSettings, auditLog } from "../db/schema";
import { NotificationsService } from "../notifications/notifications.service";
import { MediaService } from "../media/media.service";
import { QueueService, QUEUES } from "../queue/queue.module";
import { CacheService } from "../redis/redis.module";
import { newId } from "../common/ids";
import { inr } from "../ai/query";

/**
 * Admin review of listings before they go live.
 *
 *  - Submitting puts a listing "in review" (status pending): buyers can't see
 *    it; the owner is told, and admins are alerted with automatic checks.
 *  - An admin approves (it goes live and buyers are matched), asks for
 *    changes, or rejects, with reasons and a note. The owner is alerted in
 *    the app and by email, with the reasons and note.
 *  - Changes requested or rejected: the owner edits, and saving resubmits it.
 *
 * Who needs review is an admin setting (app_settings "listings"):
 * "all" (default), "unverified" (only members without KYC), or "off".
 * Admins' own listings never wait.
 */
export type ApprovalMode = "all" | "unverified" | "off";
export type Decision = "approved" | "changes" | "rejected";
export type Check = { id: string; label: string; ok: boolean; detail?: string };

/** Reasons admins pick from; shown to the owner as written. */
export const REVIEW_REASONS: Record<string, string> = {
  photos: "Add clear photos of the property (at least 3, no logos or watermarks)",
  price: "The price looks wrong for this area or size",
  details: "Some details are missing or don't match (bedrooms, area, possession)",
  location: "The location or locality looks wrong",
  contact: "Remove phone numbers, emails or links from the description",
  duplicate: "This looks like a duplicate of another listing",
  rera: "Add a valid RERA number for this project",
  ownership: "We couldn't confirm you can list this property",
  quality: "The title or description needs to be clearer",
  policy: "It doesn't meet Topsqill's listing rules",
};

const PHONE = /(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const LINK = /\b(https?:\/\/|www\.)\S+/i;

/** Automatic checks shown to the admin with each submission, and the risk they add up to. */
export function reviewChecks(l: { title: string; description?: string | null; priceInr?: number | null; areaSqft?: number | null; bhk?: number | null; purpose: string; possession?: string | null; reraNumber?: string | null; kind: string },
  extra: { photos: number; medianRate: number | null; duplicates: number; kycVerified: boolean; reraVerified: boolean; ownerType: string; accountDays: number; submittedToday: number }) {
  const text = `${l.title}\n${l.description ?? ""}`;
  const rate = l.purpose === "sale" && l.priceInr && l.areaSqft ? l.priceInr / l.areaSqft : null;
  const ratio = rate && extra.medianRate ? rate / extra.medianRate : null;
  const pro = extra.ownerType === "dealer" || extra.ownerType === "builder";
  const checks: Check[] = [
    { id: "photos", label: "Photos", ok: extra.photos >= 3, detail: extra.photos ? `${extra.photos} photo${extra.photos === 1 ? "" : "s"}` : "No photos" },
    { id: "price", label: "Price for the area", ok: ratio == null || (ratio > 0.45 && ratio < 2.2),
      detail: ratio == null ? (l.priceInr ? "No comparable listings yet" : "No price given") : `₹${Math.round(rate!).toLocaleString("en-IN")}/sq ft vs ₹${Math.round(extra.medianRate!).toLocaleString("en-IN")} median (${Math.round(ratio * 100)}%)` },
    { id: "details", label: "Key details", ok: !!l.priceInr && !!l.areaSqft && (l.kind === "Plot" || l.kind === "Office" || l.kind === "Shop" || !!l.bhk) && (l.description ?? "").trim().length >= 40,
      detail: [!l.priceInr && "price", !l.areaSqft && "area", !(l.description ?? "").trim() && "description"].filter(Boolean).join(", ") ? `Missing: ${[!l.priceInr && "price", !l.areaSqft && "area", (l.description ?? "").trim().length < 40 && "a proper description"].filter(Boolean).join(", ")}` : "Complete" },
    { id: "contact", label: "No contact details in text", ok: !PHONE.test(text) && !EMAIL.test(text) && !LINK.test(text),
      detail: PHONE.test(text) ? "Has a phone number" : EMAIL.test(text) ? "Has an email" : LINK.test(text) ? "Has a link" : "Clean" },
    { id: "duplicate", label: "Not a duplicate", ok: extra.duplicates === 0, detail: extra.duplicates ? `${extra.duplicates} similar live listing${extra.duplicates === 1 ? "" : "s"}` : "None found" },
    { id: "rera", label: "RERA number", ok: !(l.purpose === "sale" && l.possession === "Under construction") || !!l.reraNumber, detail: l.reraNumber ? l.reraNumber : l.possession === "Under construction" ? "Missing for an under-construction home" : "Not needed" },
    { id: "owner", label: "Owner verified", ok: extra.kycVerified && (!pro || extra.reraVerified),
      detail: [extra.kycVerified ? "KYC ✓" : "No KYC", pro ? (extra.reraVerified ? "RERA ✓" : "RERA not verified") : ""].filter(Boolean).join(" · ") },
    { id: "volume", label: "Normal posting volume", ok: extra.submittedToday <= 10 && extra.accountDays >= 1,
      detail: `${extra.submittedToday} submitted today · account ${extra.accountDays} day${extra.accountDays === 1 ? "" : "s"} old` },
  ];
  const weights: Record<string, number> = { photos: 1, price: 2, details: 1, contact: 2, duplicate: 3, rera: 1, owner: 1, volume: 2 };
  const score = checks.filter((c) => !c.ok).reduce((n, c) => n + (weights[c.id] ?? 1), 0);
  return { checks, risk: (score >= 4 ? "high" : score >= 2 ? "medium" : "low") as "low" | "medium" | "high" };
}

@Injectable()
export class ListingReviewService {
  private modeCache: { value: ApprovalMode; at: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly notifs: NotificationsService,
    private readonly mediaSvc: MediaService,
    private readonly queue: QueueService,
    private readonly cache: CacheService,
  ) {}

  async mode(): Promise<ApprovalMode> {
    if (this.modeCache && Date.now() - this.modeCache.at < 30_000) return this.modeCache.value;
    let value: ApprovalMode = "all";
    try {
      const [row] = await this.db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "listings")).limit(1);
      const v = (row?.value as { approval?: string } | undefined)?.approval;
      if (v === "all" || v === "unverified" || v === "off") value = v;
    } catch { /* defaults */ }
    this.modeCache = { value, at: Date.now() };
    return value;
  }

  async setMode(adminId: string, approval: ApprovalMode) {
    await this.db.insert(appSettings).values({ key: "listings", value: { approval }, updatedBy: adminId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: { approval }, updatedBy: adminId, updatedAt: new Date() } });
    this.modeCache = null;
    await this.db.insert(auditLog).values({ id: newId(), actorId: adminId, action: "settings.listing_approval", targetType: "settings", meta: { approval } }).catch(() => {});
    return { approval };
  }

  /** Does this member's listing need an admin's approval before going live? */
  async needsReview(userId: string) {
    const [u] = await this.read.select({ isAdmin: users.isAdmin, kyc: users.kycVerified }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u || u.isAdmin) return false;
    const mode = await this.mode();
    return mode === "all" || (mode === "unverified" && !u.kyc);
  }

  /** Puts a listing in the review queue (on creation, or when the owner resubmits after changes). */
  async submit(listingId: string, ownerId: string, resubmitted = false) {
    const [l] = await this.read.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l) throw new NotFoundException("That listing could not be found.");
    const { checks, risk } = await this.runChecks(l);
    await this.db.update(listings).set({ status: "pending", submittedAt: new Date(), reviewDecision: null, updatedAt: new Date() }).where(eq(listings.id, listingId));
    // Any earlier open review for this listing is closed by the new submission.
    await this.db.update(listingReviews).set({ status: "superseded", decidedAt: new Date() })
      .where(and(eq(listingReviews.listingId, listingId), eq(listingReviews.status, "pending")));
    await this.db.insert(listingReviews).values({ id: newId(), listingId, ownerId, status: "pending", checks, risk });
    await this.cache.invalidate(`listing:${listingId}`);

    await this.notifs.create({ userId: ownerId, kind: "listing", targetType: "listing", targetId: listingId,
      title: resubmitted ? "Your changes are with our team" : "Your listing is in review",
      body: `“${l.title}” will go live once approved, usually within a few hours. We’ll let you know.` }).catch(() => null);
    const admins = await this.read.select({ id: users.id }).from(users).where(and(eq(users.isAdmin, true), eq(users.status, "active"))).limit(50);
    const name = await this.notifs.nameOf(ownerId);
    for (const a of admins) {
      await this.notifs.create({ userId: a.id, kind: "system", actorId: ownerId, targetType: "review", targetId: listingId,
        title: `${resubmitted ? "Resubmitted" : "New"} listing to review from ${name}`, body: `${l.title} · ${inr(l.priceInr)} · ${risk} risk` }).catch(() => null);
    }
    return { status: "pending", risk };
  }

  private async runChecks(l: typeof listings.$inferSelect) {
    const [[photos], [median], [dupes], [owner], [today]] = await Promise.all([
      this.read.select({ n: sql<number>`count(*)::int` }).from(listingMedia).innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(and(eq(listingMedia.listingId, l.id), eq(media.kind, "image"))),
      this.read.select({ v: sql<number>`percentile_cont(0.5) within group (order by ${listings.priceInr}::numeric / nullif(${listings.areaSqft}, 0))` }).from(listings)
        .where(and(eq(listings.status, "active"), eq(listings.purpose, "sale"), sql`lower(${listings.city}) = lower(${l.city})`, sql`lower(${listings.locality}) = lower(${l.locality})`, sql`${listings.areaSqft} > 0`, ne(listings.id, l.id))),
      this.read.select({ n: sql<number>`count(*)::int` }).from(listings)
        .where(and(ne(listings.id, l.id), inArray(listings.status, ["active", "pending"]), sql`lower(${listings.title}) = lower(${l.title})`, sql`lower(${listings.locality}) = lower(${l.locality})`)),
      this.read.select({ kyc: users.kycVerified, rera: users.reraVerified, type: users.type, createdAt: users.createdAt }).from(users).where(eq(users.id, l.ownerId)).limit(1),
      this.read.select({ n: sql<number>`count(*)::int` }).from(listingReviews).where(and(eq(listingReviews.ownerId, l.ownerId), sql`${listingReviews.createdAt} > now() - interval '1 day'`)),
    ]);
    return reviewChecks(l, {
      photos: photos?.n ?? 0, medianRate: median?.v ? Number(median.v) : null, duplicates: dupes?.n ?? 0,
      kycVerified: !!owner?.kyc, reraVerified: !!owner?.rera, ownerType: owner?.type ?? "buyer",
      accountDays: owner ? Math.floor((Date.now() - owner.createdAt.getTime()) / 86_400_000) : 0, submittedToday: (today?.n ?? 0) + 1,
    });
  }

  /** The admin queue: listings waiting (or decided), with photos, owner and checks. */
  async queueFor(status: "pending" | "changes" | "rejected" | "approved") {
    const rows = await this.read.select({ r: listingReviews, l: listings, u: { id: users.id, name: users.name, type: users.type, kycVerified: users.kycVerified, reraVerified: users.reraVerified, listingCount: users.listingCount, createdAt: users.createdAt, phone: users.phone, email: users.email } })
      .from(listingReviews)
      .innerJoin(listings, eq(listings.id, listingReviews.listingId))
      .innerJoin(users, eq(users.id, listingReviews.ownerId))
      .where(eq(listingReviews.status, status))
      .orderBy(status === "pending" ? listingReviews.createdAt : desc(listingReviews.decidedAt)).limit(60);
    const ids = rows.map((x) => x.l.id);
    const pics = ids.length ? await this.read.select({ listingId: listingMedia.listingId, position: listingMedia.position, m: media }).from(listingMedia)
      .innerJoin(media, eq(media.id, listingMedia.mediaId)).where(inArray(listingMedia.listingId, ids)).orderBy(listingMedia.position) : [];
    const [counts] = await this.read.select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      changes: sql<number>`count(*) filter (where status = 'changes' and decided_at > now() - interval '30 days')::int`,
      rejected: sql<number>`count(*) filter (where status = 'rejected' and decided_at > now() - interval '30 days')::int`,
      approved: sql<number>`count(*) filter (where status = 'approved' and decided_at > now() - interval '30 days')::int`,
    }).from(listingReviews);
    return {
      counts, reasons: REVIEW_REASONS,
      items: rows.map(({ r, l, u }) => ({
        reviewId: r.id, status: r.status, risk: r.risk, checks: r.checks, reasons: r.reasons, note: r.note, submittedAt: r.createdAt, decidedAt: r.decidedAt,
        listing: { id: l.id, title: l.title, purpose: l.purpose, kind: l.kind, bhk: l.bhk, areaSqft: l.areaSqft, priceInr: l.priceInr, city: l.city, locality: l.locality,
          possession: l.possession, description: l.description, reraNumber: l.reraNumber, status: l.status, lat: l.lat, lng: l.lng },
        owner: u,
        media: pics.filter((p) => p.listingId === l.id).map((p) => this.mediaSvc.publicView(p.m)),
      })),
    };
  }

  /** Approve, ask for changes, or reject, with reasons and a note the owner sees. */
  async decide(adminId: string, listingId: string, input: { decision: Decision; reasons?: string[]; note?: string }) {
    const [l] = await this.read.select().from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l) throw new NotFoundException("That listing could not be found.");
    const reasons = [...new Set((input.reasons ?? []).filter((r) => r in REVIEW_REASONS))];
    const note = input.note?.trim().slice(0, 1000) || null;
    if (input.decision !== "approved" && !reasons.length && !note) throw new BadRequestException("Pick a reason or write a note, so the owner knows what to fix.");
    if (input.decision === "approved" && l.status !== "pending" && l.status !== "rejected") throw new BadRequestException("This listing isn't waiting for review.");

    const now = new Date();
    const approved = input.decision === "approved";
    await this.db.update(listings).set({
      status: approved ? "active" : "rejected",
      ...(approved ? { publishedAt: l.publishedAt ?? now } : {}),
      reviewDecision: input.decision, reviewReasons: reasons.map((r) => REVIEW_REASONS[r]), reviewNote: note, reviewedAt: now, updatedAt: now,
    }).where(eq(listings.id, listingId));
    // The open review (or, for a live listing taken down, a new record) gets the decision.
    const [open] = await this.db.update(listingReviews).set({ status: input.decision, reasons, note, reviewerId: adminId, decidedAt: now })
      .where(and(eq(listingReviews.listingId, listingId), eq(listingReviews.status, "pending"))).returning({ id: listingReviews.id });
    if (!open) await this.db.insert(listingReviews).values({ id: newId(), listingId, ownerId: l.ownerId, status: input.decision, reasons, note, reviewerId: adminId, decidedAt: now });
    await this.cache.invalidate(`listing:${listingId}`);
    await this.db.insert(auditLog).values({ id: newId(), actorId: adminId, action: `listing.${input.decision}`, targetType: "listing", targetId: listingId, meta: { reasons, note } }).catch(() => {});

    // Buyers waiting for exactly this are matched once it's live.
    if (approved) await this.queue.add(QUEUES.ai, "match:listing", { listingId }, `matchl-${listingId}-${Date.now()}`).catch(() => {});

    const why = [...reasons.map((r) => REVIEW_REASONS[r]), note].filter(Boolean).join(" · ");
    const msg = {
      approved: { title: `Approved: “${l.title}” is live`, body: note ? `Note from our team: ${note}` : "Buyers can now find it in search, and we’re matching it to buyers looking for a home like this." },
      changes: { title: `Changes needed on “${l.title}”`, body: `${why}. Edit the listing and save to send it back for review.` },
      rejected: { title: `“${l.title}” wasn’t approved`, body: `${why}. You can edit and resubmit it, or reply to our team.` },
    }[input.decision];
    await this.notifs.create({ userId: l.ownerId, kind: "listing", actorId: adminId, targetType: "listing", targetId: listingId, title: msg.title.slice(0, 160), body: msg.body.slice(0, 300) }).catch(() => null);
    return { ok: true, status: approved ? "active" : "rejected", decision: input.decision };
  }

  /** The review history of one listing, for its owner or an admin. */
  async history(listingId: string) {
    const rows = await this.read.select().from(listingReviews).where(eq(listingReviews.listingId, listingId)).orderBy(desc(listingReviews.createdAt)).limit(20);
    return { items: rows.map((r) => ({ ...r, reasonLabels: r.reasons.map((x) => REVIEW_REASONS[x] ?? x) })) };
  }
}
