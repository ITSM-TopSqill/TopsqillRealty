import { Injectable, Inject, ForbiddenException, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, lt, or, sql, ne } from "drizzle-orm";
import Redis from "ioredis";
import { DB, DB_READ, type Database } from "../db/db.module";
import { conversations, messages, users, media, notifications, listings, leads, campaigns } from "../db/schema";
import { REDIS } from "../redis/redis.module";
import { MediaService } from "../media/media.service";
import { NotificationsService } from "../notifications/notifications.service";
import { LeadsService } from "../leads/leads.service";
import { newId, encodeCursor, decodeCursor } from "../common/ids";
import { assertNotBlocked } from "../account/blocks";

/** Conversation ids are stable: the same two people always share one row. */
const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

@Injectable()
export class MessagingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly mediaSvc: MediaService,
    private readonly notifs: NotificationsService,
    private readonly leadsSvc: LeadsService,
  ) {}

  async openWith(userId: string, peerId: string) {
    if (userId === peerId) throw new BadRequestException("You can’t message yourself.");
    const [peer] = await this.read.select({ status: users.status }).from(users).where(eq(users.id, peerId)).limit(1);
    if (!peer || peer.status === "removed") throw new NotFoundException("That member is not available.");
    await assertNotBlocked(this.read, userId, peerId, "message this member");
    const [a, b] = pair(userId, peerId);
    const [existing] = await this.read.select().from(conversations)
      .where(and(eq(conversations.aId, a), eq(conversations.bId, b))).limit(1);
    if (existing) return existing;
    const [row] = await this.db.insert(conversations).values({ id: newId(), aId: a, bId: b })
      .onConflictDoNothing().returning();
    if (row) return row;
    const [again] = await this.read.select().from(conversations)
      .where(and(eq(conversations.aId, a), eq(conversations.bId, b))).limit(1);
    return again;
  }

  /** Inbox: conversations with the other person's details and unread counts, in three queries. */
  async inbox(userId: string, limit = 30) {
    const rows = await this.read.select().from(conversations)
      .where(or(eq(conversations.aId, userId), eq(conversations.bId, userId)))
      .orderBy(desc(conversations.lastMessageAt)).limit(Math.min(limit, 50));
    if (!rows.length) return { items: [] };

    const peerIds = rows.map((c) => (c.aId === userId ? c.bId : c.aId));
    const convoIds = rows.map((c) => c.id);
    const [peers, unread] = await Promise.all([
      this.read.select({ id: users.id, name: users.name, type: users.type, headline: users.headline, avatarMediaId: users.avatarMediaId, kycVerified: users.kycVerified })
        .from(users).where(inArray(users.id, peerIds)),
      this.read.select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(inArray(messages.conversationId, convoIds), isNull(messages.readAt), ne(messages.senderId, userId)))
        .groupBy(messages.conversationId),
    ]);
    const peerById = new Map(peers.map((p) => [p.id, p]));
    const unreadBy = new Map(unread.map((u) => [u.conversationId, u.n]));
    return {
      items: rows.map((c) => ({
        id: c.id,
        peer: peerById.get(c.aId === userId ? c.bId : c.aId) ?? null,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        lastSenderId: c.lastSenderId,
        unread: unreadBy.get(c.id) ?? 0,
      })),
    };
  }

  private async assertMember(conversationId: string, userId: string) {
    const [c] = await this.read.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!c) throw new NotFoundException("That conversation could not be found.");
    if (c.aId !== userId && c.bId !== userId) throw new ForbiddenException("This conversation isn’t yours.");
    return c;
  }

  async history(userId: string, conversationId: string, cursor?: string, limit = 30) {
    await this.assertMember(conversationId, userId);
    limit = Math.min(Math.max(limit, 1), 50);
    const cur = decodeCursor(cursor);
    const where = [eq(messages.conversationId, conversationId)];
    if (cur) where.push(or(lt(messages.createdAt, new Date(cur.t)), and(eq(messages.createdAt, new Date(cur.t)), lt(messages.id, cur.id))!)!);
    const rows = await this.read.select().from(messages).where(and(...where))
      .orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const mediaIds = [...new Set(page.flatMap((m) => m.mediaIds ?? []))];
    const pics = mediaIds.length ? await this.read.select().from(media).where(inArray(media.id, mediaIds)) : [];
    const byId = new Map(pics.map((m) => [m.id, this.mediaSvc.publicView(m)]));
    return {
      items: page.map((m) => ({ ...m, media: (m.mediaIds ?? []).map((id) => byId.get(id)).filter(Boolean) })),
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
    };
  }

  /**
   * Sends a message, updates the conversation preview in the same transaction,
   * then publishes it to Redis so every open socket for both people receives it.
   */
  async send(userId: string, conversationId: string, input: { body?: string; mediaIds?: string[]; refType?: string; refId?: string; adCampaignId?: string }) {
    const convo = await this.assertMember(conversationId, userId);
    if (!input.body?.trim() && !input.mediaIds?.length && !input.refId) throw new BadRequestException("Write a message or attach something first.");
    const other = convo.aId === userId ? convo.bId : convo.aId;
    await assertNotBlocked(this.db, userId, other, "message this member");
    const [peerRow] = await this.read.select({ status: users.status }).from(users).where(eq(users.id, other)).limit(1);
    if (!peerRow || peerRow.status === "removed") throw new BadRequestException("This member has deleted their account.");

    const id = newId();
    const preview = (input.body ?? (input.mediaIds?.length ? "📎 Attachment" : "Shared an item")).slice(0, 160);
    const row = await this.db.transaction(async (tx) => {
      const [m] = await tx.insert(messages).values({
        id, conversationId, senderId: userId, body: input.body ?? null,
        mediaIds: input.mediaIds ?? [], refType: input.refType ?? null, refId: input.refId ?? null,
      }).returning();
      await tx.update(conversations)
        .set({ lastMessageAt: m.createdAt, lastMessagePreview: preview, lastSenderId: userId })
        .where(eq(conversations.id, conversationId));
      return m;
    });

    const peerId = convo.aId === userId ? convo.bId : convo.aId;
    await this.redis.publish(`convo:${conversationId}`, JSON.stringify({ type: "message", data: row })).catch(() => {});
    // An enquiry about someone's listing also lands on their lead board.
    if (input.refType === "listing" && input.refId) await this.captureEnquiry(userId, peerId, input.refId, input.body, input.adCampaignId).catch(() => null);

    // One alert per unread chat: later messages update it instead of piling up.
    const name = await this.notifs.nameOf(userId);
    const [open] = await this.db.update(notifications).set({ body: preview, createdAt: new Date() })
      .where(and(eq(notifications.userId, peerId), eq(notifications.targetType, "conversation"), eq(notifications.targetId, conversationId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    if (!open) {
      await this.notifs.create({
        userId: peerId, kind: "message", title: `New message from ${name}`,
        body: preview, actorId: userId, targetType: "conversation", targetId: conversationId,
      });
    } else {
      await this.redis.publish(`user:${peerId}`, JSON.stringify({ type: "notification", data: { id: open.id } })).catch(() => {});
    }
    return row;
  }

  private async captureEnquiry(buyerId: string, ownerId: string, listingId: string, body?: string, adCampaignId?: string) {
    const [l] = await this.read.select({ ownerId: listings.ownerId, city: listings.city, locality: listings.locality }).from(listings).where(eq(listings.id, listingId)).limit(1);
    if (!l || l.ownerId !== ownerId) return;
    const [b] = await this.read.select({ name: users.name, phone: users.phone, email: users.email }).from(users).where(eq(users.id, buyerId)).limit(1);
    // A buyer who came from one of this listing's ads: the lead counts for that campaign.
    const [ad] = adCampaignId
      ? await this.read.select({ id: campaigns.id, platforms: campaigns.platforms }).from(campaigns).where(and(eq(campaigns.id, adCampaignId), eq(campaigns.listingId, listingId))).limit(1)
      : [];
    const { lead } = await this.leadsSvc.capture(ownerId, {
      name: b?.name, phone: b?.phone ?? undefined, email: b?.email ?? undefined,
      source: ad ? (ad.platforms?.includes("google") && !ad.platforms?.includes("meta") ? "google" : "website") : "topsqill",
      sourceDetail: ad ? "Enquiry from an ad" : "Enquiry on Topsqill.ai",
      listingId, city: l.city, locality: l.locality, note: body?.slice(0, 500),
    });
    if (ad) {
      await this.db.update(leads).set({ campaignId: ad.id }).where(and(eq(leads.id, lead.id), isNull(leads.campaignId)));
      await this.db.update(campaigns).set({ leadsCount: sql`(select count(*) from leads where campaign_id = ${ad.id})` }).where(eq(campaigns.id, ad.id));
    }
  }

  async markRead(userId: string, conversationId: string) {
    await this.assertMember(conversationId, userId);
    await this.db.update(messages).set({ readAt: new Date() })
      .where(and(eq(messages.conversationId, conversationId), ne(messages.senderId, userId), isNull(messages.readAt)));
    await this.notifs.markReadFor(userId, "conversation", conversationId);
    return { ok: true };
  }

  /** Unread messages across all chats, for the Messages badge. */
  async unreadTotal(userId: string) {
    const [r] = await this.read.select({ n: sql<number>`count(*)::int` }).from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(or(eq(conversations.aId, userId), eq(conversations.bId, userId)), ne(messages.senderId, userId), isNull(messages.readAt)));
    return { unread: r?.n ?? 0 };
  }

  /** Typing indicators are pure Redis: never written to the database. */
  async typing(userId: string, conversationId: string) {
    await this.redis.publish(`convo:${conversationId}`, JSON.stringify({ type: "typing", userId })).catch(() => {});
    return { ok: true };
  }
}
