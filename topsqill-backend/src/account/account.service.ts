import { Injectable, Inject, BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, userBlocks, connections, media, auditLog } from "../db/schema";
import { CacheService } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { newId } from "../common/ids";
import { env } from "../common/env";
import { cleanPrefs, fullPrefs, checkUnsubscribeSig, isUnsubscribeKind, ALERT_KINDS, type AlertPrefs } from "../notifications/alert-prefs";

const rowsOf = (res: unknown) => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, any>[];

@Injectable()
export class AccountService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly mediaSvc: MediaService,
  ) {}

  private async forget(...ids: string[]) {
    const keys = ids.flatMap((id) => [`profile:${id}`, `audience:${id}`]);
    await this.cache.redis.del(...keys).catch(() => 0);
  }

  /* --------------------------------- blocking --------------------------------- */

  /**
   * Blocks a member. Any connection or invitation between us goes, and from
   * now on neither of us can message, invite or see the other. They aren't told.
   */
  async block(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException("You can’t block yourself.");
    const [peer] = await this.read.select({ id: users.id, isAdmin: users.isAdmin }).from(users).where(eq(users.id, peerId)).limit(1);
    if (!peer) throw new NotFoundException("That member is not available.");
    await this.db.transaction(async (tx) => {
      await tx.insert(userBlocks).values({ blockerId: userId, blockedId: peerId }).onConflictDoNothing();
      const removed = await tx.delete(connections).where(sql`(${connections.userId} = ${userId} and ${connections.peerId} = ${peerId}) or (${connections.userId} = ${peerId} and ${connections.peerId} = ${userId})`)
        .returning({ status: connections.status });
      if (removed.some((r) => r.status === "accepted")) {
        await tx.update(users).set({ connectionCount: sql`greatest(${users.connectionCount} - 1, 0)` }).where(inArray(users.id, [userId, peerId]));
      }
      await tx.execute(sql`delete from follows where (follower_id = ${userId} and target_id = ${peerId}) or (follower_id = ${peerId} and target_id = ${userId})`);
    });
    await this.forget(userId, peerId);
    return { ok: true, blocked: true };
  }

  async unblock(userId: string, peerId: string) {
    await this.db.delete(userBlocks).where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, peerId)));
    await this.forget(userId, peerId);
    return { ok: true, blocked: false };
  }

  async blocked(userId: string) {
    const rows = await this.read.select({ id: users.id, name: users.name, type: users.type, headline: users.headline, city: users.city, avatarMediaId: users.avatarMediaId, blockedAt: userBlocks.createdAt })
      .from(userBlocks).innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, userId)).orderBy(desc(userBlocks.createdAt)).limit(500);
    const ids = rows.map((r) => r.avatarMediaId).filter(Boolean) as string[];
    const pics = ids.length ? await this.read.select().from(media).where(inArray(media.id, ids)) : [];
    const byId = new Map(pics.map((m) => [m.id, this.mediaSvc.publicView(m)]));
    return { items: rows.map(({ avatarMediaId, ...r }) => ({ ...r, avatar: avatarMediaId ? byId.get(avatarMediaId) ?? null : null })) };
  }

  /* ------------------------------ alert settings ------------------------------ */

  async alertSettings(userId: string) {
    const [u] = await this.read.select({ prefs: users.alertPrefs, email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new NotFoundException("Account not found.");
    const [push] = rowsOf(await this.read.execute(sql`select count(*)::int as n from push_tokens where user_id = ${userId}`));
    return { items: fullPrefs(u.prefs), email: u.email && u.emailVerified ? u.email : null, pushDevices: push?.n ?? 0 };
  }

  /** Saves a change to one or more switches; anything not sent keeps its value. */
  async saveAlertSettings(userId: string, patch: AlertPrefs) {
    const [u] = await this.db.select({ prefs: users.alertPrefs }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new NotFoundException("Account not found.");
    const now = cleanPrefs(u.prefs), add = cleanPrefs(patch);
    const merged: AlertPrefs = { email: { ...now.email, ...add.email }, push: { ...now.push, ...add.push } };
    await this.db.update(users).set({ alertPrefs: merged, updatedAt: new Date() }).where(eq(users.id, userId));
    return this.alertSettings(userId);
  }

  /** One-click unsubscribe from an email: signed for that member and that kind of email only. */
  async unsubscribe(userId: string, kind: string, sig: string) {
    if (!isUnsubscribeKind(kind) || !checkUnsubscribeSig(env.JWT_SECRET, userId, kind, sig)) {
      throw new BadRequestException("This unsubscribe link isn’t valid. Change your emails in Settings instead.");
    }
    const [u] = await this.db.select({ prefs: users.alertPrefs, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new NotFoundException("Account not found.");
    const prefs = cleanPrefs(u.prefs);
    for (const k of kind === "all" ? ALERT_KINDS.map((a) => a.kind) : [kind]) prefs.email![k] = false;
    await this.db.update(users).set({ alertPrefs: prefs }).where(eq(users.id, userId));
    const label = kind === "all" ? "Topsqill.ai alert emails" : `emails about ${ALERT_KINDS.find((a) => a.kind === kind)!.label.toLowerCase()}`;
    return { ok: true, kind, message: `You won’t get ${label} any more.` };
  }

  /* ------------------------------- deleting ------------------------------- */

  /** What would stop the account being deleted right now, so the page can say so up front. */
  async deletionCheck(userId: string) {
    const [u] = await this.read.select({ isAdmin: users.isAdmin, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u || u.status === "removed") throw new NotFoundException("Account not found.");
    const [w] = rowsOf(await this.read.execute(sql`select coalesce(balance_paise,0)::bigint as balance, coalesce(held_paise,0)::bigint as held from wallets where owner_id = ${userId}`));
    const [c] = rowsOf(await this.read.execute(sql`select count(*)::int as n from campaigns where owner_id = ${userId} and status in ('active','scheduled','paused','review')`));
    const [n] = rowsOf(await this.read.execute(sql`select
        (select count(*)::int from listings where owner_id = ${userId} and status <> 'archived') as listings,
        (select count(*)::int from posts where author_id = ${userId} and hidden = false) as posts,
        (select count(*)::int from leads where owner_id = ${userId}) as leads,
        (select connection_count from users where id = ${userId}) as connections`));
    const blockers: string[] = [];
    if (u.isAdmin) blockers.push("You’re an admin. Ask another admin to remove your admin access first.");
    if (c?.n) blockers.push(`You have ${c.n} ad campaign${c.n === 1 ? "" : "s"} running or waiting. End ${c.n === 1 ? "it" : "them"} first.`);
    if (Number(w?.balance ?? 0) + Number(w?.held ?? 0) > 0) blockers.push(`Your ad wallet still has ₹${((Number(w.balance) + Number(w.held)) / 100).toLocaleString("en-IN")}. Write to support for a refund before deleting.`);
    return { canDelete: blockers.length === 0, blockers, counts: n ?? {} };
  }

  /**
   * Deletes the account for good. Personal details are wiped and everything
   * the member published is taken down; messages already sent stay with the
   * people who received them, shown as from "Deleted member". Billing records
   * (payments, invoices) are kept, as tax law requires, but no longer linked
   * to a name.
   */
  async deleteAccount(userId: string, confirm: string) {
    if (String(confirm ?? "").trim().toUpperCase() !== "DELETE") throw new BadRequestException("Type DELETE to confirm.");
    const check = await this.deletionCheck(userId);
    if (!check.canDelete) throw new ConflictException(check.blockers[0]);

    const peers = await this.db.transaction(async (tx) => {
      const conns = rowsOf(await tx.execute(sql`delete from connections where user_id = ${userId} or peer_id = ${userId} returning user_id, peer_id, status`));
      const friends = [...new Set(conns.filter((r) => r.status === "accepted").map((r) => (r.user_id === userId ? r.peer_id : r.user_id)))] as string[];
      if (friends.length) await tx.update(users).set({ connectionCount: sql`greatest(${users.connectionCount} - 1, 0)` }).where(inArray(users.id, friends));
      const followed = rowsOf(await tx.execute(sql`delete from follows where follower_id = ${userId} returning target_id`)).map((r) => r.target_id as string);
      if (followed.length) await tx.update(users).set({ followerCount: sql`greatest(${users.followerCount} - 1, 0)` }).where(inArray(users.id, followed));
      await tx.execute(sql`delete from follows where target_id = ${userId}`);

      // Take down everything published.
      await tx.execute(sql`update listings set status = 'archived', hidden = true, updated_at = now() where owner_id = ${userId}`);
      await tx.execute(sql`update posts set hidden = true where author_id = ${userId}`);
      await tx.execute(sql`update post_comments set hidden = true where author_id = ${userId}`);
      await tx.execute(sql`update requirements set status = 'closed' where user_id = ${userId}`);
      await tx.execute(sql`update jobs set status = 'closed' where owner_id = ${userId}`);
      await tx.execute(sql`update campaigns set status = 'completed' where owner_id = ${userId} and status = 'draft'`);

      // Personal data the member collected or created about others goes too.
      await tx.execute(sql`delete from lead_activities where lead_id in (select id from leads where owner_id = ${userId})`);
      await tx.execute(sql`delete from leads where owner_id = ${userId}`);
      await tx.execute(sql`delete from lead_sources where owner_id = ${userId}`);
      await tx.execute(sql`delete from whatsapp_optins where owner_id = ${userId}`);
      await tx.execute(sql`delete from whatsapp_messages where owner_id = ${userId}`);
      await tx.execute(sql`delete from whatsapp_accounts where owner_id = ${userId}`);
      await tx.execute(sql`delete from instagram_accounts where owner_id = ${userId}`);
      await tx.execute(sql`delete from job_applications where user_id = ${userId}`);
      await tx.execute(sql`delete from saved_items where user_id = ${userId}`);
      await tx.execute(sql`delete from profile_views where viewer_id = ${userId} or profile_id = ${userId}`);
      await tx.execute(sql`delete from notifications where user_id = ${userId}`);
      await tx.execute(sql`delete from push_tokens where user_id = ${userId}`);
      await tx.execute(sql`delete from user_blocks where blocker_id = ${userId} or blocked_id = ${userId}`);
      await tx.execute(sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`);
      await tx.execute(sql`update media set status = 'blocked' where owner_id = ${userId}`);

      await tx.update(users).set({
        status: "removed", name: "Deleted member", phone: null, email: null, emailVerified: false,
        headline: null, about: null, agency: null, city: null, yearsExperience: null, reraNumber: null,
        localities: [], specialties: [], interests: [], avatarMediaId: null, coverMediaId: null,
        alertPrefs: {}, connectionCount: 0, followerCount: 0, listingCount: 0, deletedAt: new Date(), updatedAt: new Date(),
      }).where(eq(users.id, userId));
      await tx.insert(auditLog).values({ id: newId(), actorId: userId, action: "account.deleted", targetType: "user", targetId: userId, meta: { by: "member" } });
      return [...friends, ...followed];
    });
    await this.forget(userId, ...peers);
    return { ok: true, deleted: true };
  }
}
