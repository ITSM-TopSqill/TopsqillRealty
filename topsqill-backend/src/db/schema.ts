/**
 * Topsqill.ai database schema (Phase 0 + core of Phase 1).
 *
 * Design rules used throughout:
 *  - IDs are UUIDv7 (time-ordered), generated in the app, so new rows land together in indexes.
 *  - Counters (likes, comments, connections) are stored on the row, never counted live.
 *  - Every index below exists because a real screen needs it.
 *  - Media files live in Cloud Storage; only small records are kept here.
 */
import { pgTable, text, varchar, integer, bigint, boolean, timestamp, jsonb, index, uniqueIndex, primaryKey, pgEnum, doublePrecision, smallint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const profileType = pgEnum("profile_type", ["buyer", "seller", "dealer", "builder"]);
export const userStatus = pgEnum("user_status", ["pending", "active", "suspended", "removed"]);
export const listingStatus = pgEnum("listing_status", ["draft", "pending", "active", "sold", "archived"]);
export const purposeEnum = pgEnum("purpose", ["sale", "rent"]);
export const mediaKind = pgEnum("media_kind", ["image", "video", "model3d", "document"]);
export const mediaStatus = pgEnum("media_status", ["uploading", "processing", "ready", "failed", "blocked"]);
export const connStatus = pgEnum("connection_status", ["pending", "accepted", "ignored"]);
export const postKind = pgEnum("post_kind", ["update", "listing", "requirement", "project", "job", "insight"]);

/* ------------------------------ users & profiles ------------------------------ */

export const users = pgTable("users", {
  id: varchar("id", { length: 36 }).primaryKey(),
  phone: varchar("phone", { length: 16 }),                        // E.164, e.g. +919355135887; null for email-only members
  email: varchar("email", { length: 160 }),
  // True only once the member proved they own the address with a code.
  // Only verified addresses can be used to sign in, and each one only once.
  emailVerified: boolean("email_verified").notNull().default(false),
  name: varchar("name", { length: 120 }).notNull(),
  type: profileType("type").notNull().default("buyer"),
  status: userStatus("status").notNull().default("pending"),
  isAdmin: boolean("is_admin").notNull().default(false),
  kycVerified: boolean("kyc_verified").notNull().default(false),
  reraNumber: varchar("rera_number", { length: 64 }),
  reraVerified: boolean("rera_verified").notNull().default(false),
  city: varchar("city", { length: 80 }),
  localities: jsonb("localities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  headline: varchar("headline", { length: 160 }),
  about: text("about"),
  agency: varchar("agency", { length: 160 }),
  yearsExperience: smallint("years_experience"),
  avatarMediaId: varchar("avatar_media_id", { length: 36 }),
  coverMediaId: varchar("cover_media_id", { length: 36 }),
  connectionCount: integer("connection_count").notNull().default(0),
  followerCount: integer("follower_count").notNull().default(0),
  listingCount: integer("listing_count").notNull().default(0),
  suspendedReason: varchar("suspended_reason", { length: 200 }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  phoneUq: uniqueIndex("users_phone_uq").on(t.phone),
  emailVerifiedUq: uniqueIndex("users_email_verified_uq").on(sql`lower(${t.email})`).where(sql`${t.emailVerified}`),
  // "dealers in Gurgaon", newest first
  typeCityIdx: index("users_type_city_idx").on(t.type, t.city, t.createdAt.desc()).where(sql`${t.status} = 'active'`),
  // name search (trigram index is added in the SQL migration)
  nameIdx: index("users_name_idx").on(t.name),
}));

export const refreshTokens = pgTable("refresh_tokens", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),     // sha256, never the token itself
  device: varchar("device", { length: 160 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashUq: uniqueIndex("refresh_token_hash_uq").on(t.tokenHash),
  userIdx: index("refresh_user_idx").on(t.userId, t.expiresAt),
}));

/* ---------------------------------- media ---------------------------------- */
// One row per uploaded file. Variants (sizes, HLS renditions, compressed 3D) are
// produced by background workers and listed in `variants`.

export const media = pgTable("media", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  kind: mediaKind("kind").notNull(),
  status: mediaStatus("status").notNull().default("uploading"),
  objectPath: text("object_path").notNull(),                      // path in the uploads bucket
  mimeType: varchar("mime_type", { length: 100 }).notNull(),
  bytes: bigint("bytes", { mode: "number" }),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  blurhash: varchar("blurhash", { length: 64 }),                  // tiny preview shown instantly
  label: varchar("label", { length: 60 }),                        // "Exterior", "Swimming pool"
  groupName: varchar("group_name", { length: 24 }),               // exterior | interior | amenity | plan | other
  caption: varchar("caption", { length: 200 }),
  variants: jsonb("variants").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("media_owner_idx").on(t.ownerId, t.createdAt.desc()),
  statusIdx: index("media_status_idx").on(t.status).where(sql`${t.status} in ('uploading','processing')`),
}));

/* --------------------------------- listings --------------------------------- */

export const listings = pgTable("listings", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  status: listingStatus("status").notNull().default("draft"),
  title: varchar("title", { length: 140 }).notNull(),
  purpose: purposeEnum("purpose").notNull().default("sale"),
  kind: varchar("kind", { length: 24 }).notNull(),                // Apartment | Villa | Plot | Office | Shop
  bhk: smallint("bhk"),
  areaSqft: integer("area_sqft"),
  priceInr: bigint("price_inr", { mode: "number" }),              // monthly rent when purpose = rent
  city: varchar("city", { length: 80 }).notNull(),
  locality: varchar("locality", { length: 120 }).notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  possession: varchar("possession", { length: 32 }),
  furnishing: varchar("furnishing", { length: 32 }),
  facing: varchar("facing", { length: 40 }),
  description: text("description"),
  amenities: jsonb("amenities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  usps: jsonb("usps").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  coverMediaId: varchar("cover_media_id", { length: 36 }),
  projectId: varchar("project_id", { length: 36 }),
  projectSourceId: varchar("project_source_id", { length: 36 }),
  reraNumber: varchar("rera_number", { length: 64 }),
  videoUrl: text("video_url"),                                    // YouTube or Vimeo walkthrough
  tourUrl: text("tour_url"),                                      // Matterport, Kuula... 3D tour
  sourceUrl: text("source_url"),                                  // the page it was imported from
  verified: boolean("verified").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  viewCount: integer("view_count").notNull().default(0),
  saveCount: integer("save_count").notNull().default(0),
  leadCount: integer("lead_count").notNull().default(0),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // the search screen: city + purpose + bhk + price, newest first, active only
  searchIdx: index("listings_search_idx")
    .on(t.city, t.purpose, t.bhk, t.priceInr, t.publishedAt.desc())
    .where(sql`${t.status} = 'active'`),
  localityIdx: index("listings_locality_idx").on(t.locality, t.purpose, t.publishedAt.desc()).where(sql`${t.status} = 'active'`),
  ownerIdx: index("listings_owner_idx").on(t.ownerId, t.createdAt.desc()),
  // keyset pagination for "newest listings"
  feedIdx: index("listings_published_idx").on(t.publishedAt.desc(), t.id.desc()).where(sql`${t.status} = 'active'`),
}));

export const listingMedia = pgTable("listing_media", {
  listingId: varchar("listing_id", { length: 36 }).notNull(),
  mediaId: varchar("media_id", { length: 36 }).notNull(),
  position: smallint("position").notNull().default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.listingId, t.mediaId] }),
  listingIdx: index("listing_media_idx").on(t.listingId, t.position),
}));

/* --------------------------------- network --------------------------------- */
// Both directions are stored, so "my connections" is always one index scan.

export const connections = pgTable("connections", {
  userId: varchar("user_id", { length: 36 }).notNull(),
  peerId: varchar("peer_id", { length: 36 }).notNull(),
  status: connStatus("status").notNull().default("pending"),
  requestedBy: varchar("requested_by", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.peerId] }),
  listIdx: index("connections_list_idx").on(t.userId, t.status, t.createdAt.desc()),
}));

export const follows = pgTable("follows", {
  followerId: varchar("follower_id", { length: 36 }).notNull(),
  targetId: varchar("target_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.followerId, t.targetId] }),
  targetIdx: index("follows_target_idx").on(t.targetId, t.createdAt.desc()),
}));

/* ----------------------------------- feed ----------------------------------- */

export const posts = pgTable("posts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  authorId: varchar("author_id", { length: 36 }).notNull(),
  kind: postKind("kind").notNull().default("update"),
  body: text("body").notNull(),
  refId: varchar("ref_id", { length: 36 }),                       // listing / project / job this post is about
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  repostCount: integer("repost_count").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  authorIdx: index("posts_author_idx").on(t.authorId, t.createdAt.desc()).where(sql`${t.hidden} = false`),
  recentIdx: index("posts_recent_idx").on(t.createdAt.desc(), t.id.desc()).where(sql`${t.hidden} = false`),
}));

export const postLikes = pgTable("post_likes", {
  postId: varchar("post_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.postId, t.userId] }) }));

export const postComments = pgTable("post_comments", {
  id: varchar("id", { length: 36 }).primaryKey(),
  postId: varchar("post_id", { length: 36 }).notNull(),
  authorId: varchar("author_id", { length: 36 }).notNull(),
  body: text("body").notNull(),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ postIdx: index("post_comments_idx").on(t.postId, t.createdAt.desc()) }));

/* ------------------------- requirements & matching ------------------------- */

export const requirementStatus = pgEnum("requirement_status", ["active", "matched", "closed"]);
export const reportStatus = pgEnum("report_status", ["open", "actioned", "dismissed"]);

export const requirements = pgTable("requirements", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  status: requirementStatus("status").notNull().default("active"),
  purpose: purposeEnum("purpose").notNull().default("sale"),
  kind: varchar("kind", { length: 24 }).notNull().default("Apartment"),
  bhk: smallint("bhk"),
  city: varchar("city", { length: 80 }).notNull(),
  localities: jsonb("localities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  minPrice: bigint("min_price", { mode: "number" }),
  maxPrice: bigint("max_price", { mode: "number" }),
  minArea: integer("min_area"),
  timeline: varchar("timeline", { length: 32 }),
  needsLoan: boolean("needs_loan").notNull().default(false),
  note: text("note"),
  matchCount: integer("match_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cityIdx: index("requirements_city_idx").on(t.city, t.purpose, t.createdAt.desc()).where(sql`${t.status} = 'active'`),
  userIdx: index("requirements_user_idx").on(t.userId, t.createdAt.desc()),
}));

export const requirementMatches = pgTable("requirement_matches", {
  requirementId: varchar("requirement_id", { length: 36 }).notNull(),
  listingId: varchar("listing_id", { length: 36 }).notNull(),
  score: smallint("score").notNull(),
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.requirementId, t.listingId] }),
  bestIdx: index("requirement_matches_idx").on(t.requirementId, t.score.desc()),
}));

export const savedItems = pgTable("saved_items", {
  userId: varchar("user_id", { length: 36 }).notNull(),
  itemType: varchar("item_type", { length: 16 }).notNull(),
  itemId: varchar("item_id", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.itemType, t.itemId] }),
  listIdx: index("saved_items_idx").on(t.userId, t.itemType, t.createdAt.desc()),
}));

/* ------------------------------- moderation ------------------------------- */

export const reports = pgTable("reports", {
  id: varchar("id", { length: 36 }).primaryKey(),
  reporterId: varchar("reporter_id", { length: 36 }),
  targetType: varchar("target_type", { length: 16 }).notNull(),
  targetId: varchar("target_id", { length: 36 }).notNull(),
  reason: varchar("reason", { length: 60 }).notNull(),
  detail: text("detail"),
  status: reportStatus("status").notNull().default("open"),
  aiConfidence: smallint("ai_confidence"),
  aiReason: varchar("ai_reason", { length: 120 }),
  reviewedBy: varchar("reviewed_by", { length: 36 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  openIdx: index("reports_open_idx").on(t.status, t.createdAt.desc()).where(sql`${t.status} = 'open'`),
  targetIdx: index("reports_target_idx").on(t.targetType, t.targetId),
}));

export const verifications = pgTable("verifications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  documents: jsonb("documents").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  risk: varchar("risk", { length: 8 }),
  riskScore: smallint("risk_score"),
  aiChecks: jsonb("ai_checks").$type<{ label: string; ok: boolean }[]>(),
  aiNote: varchar("ai_note", { length: 300 }),
  note: text("note"),
  reviewedBy: varchar("reviewed_by", { length: 36 }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  queueIdx: index("verifications_queue_idx").on(t.status, t.createdAt),
  userIdx: index("verifications_user_idx").on(t.userId, t.createdAt.desc()),
}));

/* ------------------------------- messaging ------------------------------- */

export const leadStage = pgEnum("lead_stage", ["new", "contacted", "site_visit", "negotiation", "booked", "lost"]);
export const leadSource = pgEnum("lead_source", ["website", "meta", "google", "linkedin", "whatsapp", "portal_99acres", "portal_magicbricks", "portal_housing", "call", "topsqill", "manual", "other"]);
export const notifKind = pgEnum("notif_kind", ["connection", "message", "lead", "match", "post", "comment", "system", "job"]);

export const conversations = pgTable("conversations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  aId: varchar("a_id", { length: 36 }).notNull(),        // always the smaller of the two ids
  bId: varchar("b_id", { length: 36 }).notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastMessagePreview: varchar("last_message_preview", { length: 160 }),
  lastSenderId: varchar("last_sender_id", { length: 36 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pairUq: uniqueIndex("conversations_pair_uq").on(t.aId, t.bId),
  aIdx: index("conversations_a_idx").on(t.aId, t.lastMessageAt.desc()),
  bIdx: index("conversations_b_idx").on(t.bId, t.lastMessageAt.desc()),
}));

export const messages = pgTable("messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  senderId: varchar("sender_id", { length: 36 }).notNull(),
  body: text("body"),
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  refType: varchar("ref_type", { length: 16 }),
  refId: varchar("ref_id", { length: 36 }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  convoIdx: index("messages_convo_idx").on(t.conversationId, t.createdAt.desc(), t.id.desc()),
  unreadIdx: index("messages_unread_idx").on(t.conversationId, t.senderId).where(sql`${t.readAt} is null`),
}));

export const notifications = pgTable("notifications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  kind: notifKind("kind").notNull(),
  title: varchar("title", { length: 160 }).notNull(),
  body: varchar("body", { length: 300 }),
  actorId: varchar("actor_id", { length: 36 }),
  targetType: varchar("target_type", { length: 16 }),
  targetId: varchar("target_id", { length: 36 }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index("notifications_user_idx").on(t.userId, t.createdAt.desc()),
  unreadIdx: index("notifications_unread_idx").on(t.userId).where(sql`${t.readAt} is null`),
}));

export const pushTokens = pgTable("push_tokens", {
  token: varchar("token", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  platform: varchar("platform", { length: 12 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userIdx: index("push_tokens_user_idx").on(t.userId) }));

/* ------------------------------ leads & CRM ------------------------------ */

export const leads = pgTable("leads", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  assigneeId: varchar("assignee_id", { length: 36 }),
  name: varchar("name", { length: 120 }).notNull(),
  phone: varchar("phone", { length: 16 }),
  email: varchar("email", { length: 160 }),
  source: leadSource("source").notNull().default("other"),
  sourceDetail: varchar("source_detail", { length: 120 }),
  listingId: varchar("listing_id", { length: 36 }),
  requirementId: varchar("requirement_id", { length: 36 }),
  stage: leadStage("stage").notNull().default("new"),
  score: smallint("score").notNull().default(50),
  scoreReason: varchar("score_reason", { length: 200 }),
  budgetMin: bigint("budget_min", { mode: "number" }),
  budgetMax: bigint("budget_max", { mode: "number" }),
  city: varchar("city", { length: 80 }),
  locality: varchar("locality", { length: 120 }),
  note: text("note"),
  qualified: boolean("qualified").notNull().default(false),
  otpVerified: boolean("otp_verified").notNull().default(false),
  externalId: varchar("external_id", { length: 120 }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  boardIdx: index("leads_board_idx").on(t.ownerId, t.stage, t.createdAt.desc()),
  assigneeIdx: index("leads_assignee_idx").on(t.assigneeId, t.stage, t.createdAt.desc()),
  phoneIdx: index("leads_phone_idx").on(t.ownerId, t.phone),
}));

export const leadActivities = pgTable("lead_activities", {
  id: varchar("id", { length: 36 }).primaryKey(),
  leadId: varchar("lead_id", { length: 36 }).notNull(),
  actorId: varchar("actor_id", { length: 36 }),
  kind: varchar("kind", { length: 24 }).notNull(),
  body: text("body"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ leadIdx: index("lead_activities_idx").on(t.leadId, t.createdAt.desc()) }));

export const leadSources = pgTable("lead_sources", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  source: leadSource("source").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  ingestKey: varchar("ingest_key", { length: 48 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  assignRule: varchar("assign_rule", { length: 24 }).notNull().default("owner"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  leadCount: integer("lead_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  keyUq: uniqueIndex("lead_sources_key_uq").on(t.ingestKey),
  ownerIdx: index("lead_sources_owner_idx").on(t.ownerId, t.source),
}));

export const ingestEvents = pgTable("ingest_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sourceId: varchar("source_id", { length: 36 }),
  status: varchar("status", { length: 16 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  leadId: varchar("lead_id", { length: 36 }),
  error: varchar("error", { length: 300 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ sourceIdx: index("ingest_events_idx").on(t.sourceId, t.createdAt.desc()) }));

/* ------------------------- projects, jobs, campaigns ------------------------- */

export const jobStatus = pgEnum("job_status", ["draft", "open", "closed"]);
export const applicationStatus = pgEnum("application_status", ["applied", "viewed", "shortlisted", "rejected", "hired"]);
export const campaignStatus = pgEnum("campaign_status", ["draft", "scheduled", "active", "paused", "completed"]);

export const projects = pgTable("projects", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  sourceUrl: text("source_url"),
  name: varchar("name", { length: 160 }).notNull(),
  builder: varchar("builder", { length: 160 }),
  city: varchar("city", { length: 80 }).notNull(),
  locality: varchar("locality", { length: 120 }).notNull(),
  reraNumber: varchar("rera_number", { length: 64 }),
  status: varchar("status", { length: 24 }).notNull().default("Under construction"),
  possession: varchar("possession", { length: 32 }),
  acres: varchar("acres", { length: 12 }),
  towers: smallint("towers"),
  floors: smallint("floors"),
  units: integer("units"),
  openArea: smallint("open_area"),
  paymentPlan: varchar("payment_plan", { length: 40 }),
  facing: jsonb("facing").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  amenities: jsonb("amenities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  specs: jsonb("specs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  configs: jsonb("configs").$type<{ bhk: number; sbua: number; carpet: number; price: number; estimated?: boolean }[]>().notNull().default(sql`'[]'::jsonb`),
  nearby: jsonb("nearby").$type<{ name: string; km: number; icon: string }[]>().notNull().default(sql`'[]'::jsonb`),
  usps: jsonb("usps").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  summary: text("summary"),
  verdict: varchar("verdict", { length: 300 }),
  risk: jsonb("risk").$type<{ score: number; level: string; factors: { label: string; level: string; note: string }[] }>(),
  priceEstimated: boolean("price_estimated").notNull().default(false),
  aiSource: varchar("ai_source", { length: 16 }).notNull().default("rules"),
  published: boolean("published").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerIdx: index("projects_owner_idx").on(t.ownerId, t.createdAt.desc()) }));

export const projectMedia = pgTable("project_media", {
  projectId: varchar("project_id", { length: 36 }).notNull(),
  mediaId: varchar("media_id", { length: 36 }).notNull(),
  position: smallint("position").notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.projectId, t.mediaId] }) }));

export const jobs = pgTable("jobs", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  company: varchar("company", { length: 160 }).notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  category: varchar("category", { length: 40 }).notNull(),
  employment: varchar("employment", { length: 24 }).notNull().default("Full-time"),
  workMode: varchar("work_mode", { length: 16 }).notNull().default("On-site"),
  city: varchar("city", { length: 80 }).notNull(),
  locality: varchar("locality", { length: 120 }),
  openings: smallint("openings").notNull().default(1),
  expMin: smallint("exp_min").notNull().default(0),
  expMax: smallint("exp_max").notNull().default(5),
  salaryMin: varchar("salary_min", { length: 12 }),
  salaryMax: varchar("salary_max", { length: 12 }),
  incentives: boolean("incentives").notNull().default(false),
  skills: jsonb("skills").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  summary: text("summary"),
  responsibilities: jsonb("responsibilities").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  requirements: jsonb("requirements").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: jobStatus("status").notNull().default("open"),
  applicantCount: integer("applicant_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  searchIdx: index("jobs_search_idx").on(t.city, t.category, t.createdAt.desc()).where(sql`${t.status} = 'open'`),
  ownerIdx: index("jobs_owner_idx").on(t.ownerId, t.createdAt.desc()),
}));

export const jobApplications = pgTable("job_applications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  jobId: varchar("job_id", { length: 36 }).notNull(),
  userId: varchar("user_id", { length: 36 }).notNull(),
  note: text("note"),
  phone: varchar("phone", { length: 16 }),
  email: varchar("email", { length: 160 }),
  yearsExperience: smallint("years_experience"),
  noticePeriod: varchar("notice_period", { length: 24 }),
  matchScore: smallint("match_score"),
  status: applicationStatus("status").notNull().default("applied"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobIdx: index("job_applications_job_idx").on(t.jobId, t.createdAt.desc()),
  userIdx: index("job_applications_user_idx").on(t.userId, t.createdAt.desc()),
}));

export const campaigns = pgTable("campaigns", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  listingId: varchar("listing_id", { length: 36 }),
  projectId: varchar("project_id", { length: 36 }),
  name: varchar("name", { length: 160 }).notNull(),
  goal: varchar("goal", { length: 40 }).notNull().default("Qualified buyers"),
  budgetInr: bigint("budget_inr", { mode: "number" }).notNull(),
  days: smallint("days").notNull().default(15),
  status: campaignStatus("status").notNull().default("draft"),
  plan: jsonb("plan").$type<Record<string, unknown>>(),
  creatives: jsonb("creatives").$type<Record<string, unknown>>(),
  forecast: jsonb("forecast").$type<Record<string, number>>(),
  spendInr: bigint("spend_inr", { mode: "number" }).notNull().default(0),
  leadsCount: integer("leads_count").notNull().default(0),
  qualifiedCount: integer("qualified_count").notNull().default(0),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ ownerIdx: index("campaigns_owner_idx").on(t.ownerId, t.createdAt.desc()) }));

export const aiUsage = pgTable("ai_usage", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: varchar("user_id", { length: 36 }),
  feature: varchar("feature", { length: 40 }).notNull(),
  model: varchar("model", { length: 60 }),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  ms: integer("ms"),
  ok: boolean("ok").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ userIdx: index("ai_usage_user_idx").on(t.userId, t.createdAt.desc()) }));

/* --------------------- ad platforms & WhatsApp sending --------------------- */

export const adAccounts = pgTable("ad_accounts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  accountId: varchar("account_id", { length: 120 }).notNull(),
  accountName: varchar("account_name", { length: 160 }),
  secretRef: varchar("secret_ref", { length: 160 }),   // Secret Manager name, never the token itself
  status: varchar("status", { length: 16 }).notNull().default("connected"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("ad_accounts_uq").on(t.ownerId, t.platform, t.accountId),
  ownerIdx: index("ad_accounts_owner_idx").on(t.ownerId, t.platform),
}));

export const campaignDeliveries = pgTable("campaign_deliveries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  campaignId: varchar("campaign_id", { length: 36 }).notNull(),
  platform: varchar("platform", { length: 16 }).notNull(),
  externalCampaignId: varchar("external_campaign_id", { length: 120 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  budgetInr: bigint("budget_inr", { mode: "number" }).notNull(),
  error: varchar("error", { length: 300 }),
  stats: jsonb("stats").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ campaignIdx: index("campaign_deliveries_idx").on(t.campaignId) }));

export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  wabaId: varchar("waba_id", { length: 60 }).notNull(),
  phoneNumberId: varchar("phone_number_id", { length: 60 }).notNull(),
  displayNumber: varchar("display_number", { length: 20 }),
  secretRef: varchar("secret_ref", { length: 160 }),
  qualityRating: varchar("quality_rating", { length: 16 }),
  status: varchar("status", { length: 16 }).notNull().default("connected"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("whatsapp_accounts_uq").on(t.phoneNumberId),
  ownerIdx: index("whatsapp_accounts_owner_idx").on(t.ownerId),
}));

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: varchar("id", { length: 36 }).primaryKey(),
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  leadId: varchar("lead_id", { length: 36 }),
  toNumber: varchar("to_number", { length: 16 }).notNull(),
  direction: varchar("direction", { length: 8 }).notNull(),
  template: varchar("template", { length: 80 }),
  body: text("body"),
  wamid: varchar("wamid", { length: 120 }),
  status: varchar("status", { length: 16 }).notNull().default("queued"),
  error: varchar("error", { length: 300 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index("whatsapp_messages_lead_idx").on(t.leadId, t.createdAt.desc()),
  ownerIdx: index("whatsapp_messages_owner_idx").on(t.ownerId, t.createdAt.desc()),
}));

export const whatsappOptins = pgTable("whatsapp_optins", {
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  phone: varchar("phone", { length: 16 }).notNull(),
  source: varchar("source", { length: 40 }).notNull(),
  proof: varchar("proof", { length: 200 }),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.ownerId, t.phone] }) }));

/* ---------------------------------- audit ---------------------------------- */

export const auditLog = pgTable("audit_log", {
  id: varchar("id", { length: 36 }).primaryKey(),
  actorId: varchar("actor_id", { length: 36 }),
  action: varchar("action", { length: 60 }).notNull(),
  targetType: varchar("target_type", { length: 40 }),
  targetId: varchar("target_id", { length: 36 }),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ recentIdx: index("audit_recent_idx").on(t.createdAt.desc()) }));
