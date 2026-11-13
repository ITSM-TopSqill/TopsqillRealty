import { normaliseAds } from "../ads/settings";
import { adsSecret } from "../ads/secrets";
import { Injectable, Inject, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { and, desc, eq, sql, inArray, gte } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { users, listings, posts, postComments, reports, verifications, auditLog, media, appSettings, adAccounts, whatsappAccounts, leadSources, instagramAccounts, aiUsage } from "../db/schema";
import { AI_FEATURES, AI_MODELS, cleanAiSettings } from "../ai/ai-settings";
import { CacheService } from "../redis/redis.module";
import { NotificationsService } from "../notifications/notifications.service";
import { MediaService } from "../media/media.service";
import { ClaudeService } from "../ai/claude.service";
import { env } from "../common/env";
import { apishKeys } from "../common/key-pool";
import { newId } from "../common/ids";

type Decision = "approved" | "rejected" | "info";

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly cache: CacheService,
    private readonly notifs: NotificationsService,
    private readonly mediaSvc: MediaService,
    private readonly claude: ClaudeService,
  ) {}

  /* --------------------------------- AI --------------------------------- */

  /** Calls, failures and tokens per AI feature over the last 7 days, and today. */
  /** Re-reads the api.sh keys on this server now (the others pick changes up within 5 minutes). */
  async reloadScraperKeys(adminId: string) {
    apishKeys.reload();
    const status = await apishKeys.status();
    await this.db.insert(auditLog).values({ id: newId(), actorId: adminId, action: "scraper.keys.reload", targetType: "settings", meta: { keys: status.keys.length, source: status.source } }).catch(() => {});
    return status;
  }

  /** AI settings for Admin → AI: on/off, per feature, and the model. */
  async aiSettings() {
    return { settings: await this.claude.settings(), features: AI_FEATURES, models: AI_MODELS, defaultModel: env.CLAUDE_MODEL, configured: this.claude.available };
  }

  async saveAiSettings(adminId: string, input: unknown) {
    const value = cleanAiSettings(input);
    await this.db.insert(appSettings).values({ key: "ai", value, updatedBy: adminId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: adminId, updatedAt: new Date() } });
    this.claude.resetSettings();
    await this.db.insert(auditLog).values({ id: newId(), actorId: adminId, action: "settings.ai", targetType: "settings", meta: value }).catch(() => {});
    return this.aiSettings();
  }

  /**
   * Every outside service Topsqill uses, and whether it's set up: from the
   * settings that are present (never their values) and, where cheap, how it
   * has been doing (AI calls in the last 24 hours, api.sh keys working).
   */
  async connectors() {
    const [[ai24], [counts]] = await Promise.all([
      this.read.select({ calls: sql<number>`count(*)::int`, failed: sql<number>`count(*) filter (where not ${aiUsage.ok})::int` })
        .from(aiUsage).where(sql`${aiUsage.createdAt} > now() - interval '24 hours' and ${aiUsage.feature} not like 'fetch.%'`),
      this.read.select({
        ads: sql<number>`(select count(*) from ${adAccounts})::int`,
        waBusiness: sql<number>`(select count(*) from ${whatsappAccounts} where status = 'connected')::int`,
        sources: sql<number>`(select count(*) from ${leadSources})::int`,
        instagram: sql<number>`(select count(*) from ${instagramAccounts})::int`,
      }).from(sql`(select 1) one`),
    ]);
    const apish = apishKeys.configured ? await apishKeys.status() : null;
    const [adsRow] = await this.read.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, "ads")).limit(1);
    const ads = normaliseAds(adsRow?.value as never);
    const [metaTok, gDev, gOauth, rpSecret, rpHook] = await Promise.all(["meta-ads-token", "google-ads-developer-token", "google-ads-oauth", "razorpay-key-secret", "razorpay-webhook-secret"].map((n) => adsSecret(n as never)));
    const settings = await this.claude.settings();
    type C = { id: string; name: string; group: string; status: "on" | "off" | "warning"; detail: string; setup?: string };
    const c: C[] = [
      { id: "claude", name: "Claude (AI)", group: "AI", status: !this.claude.available ? "off" : !settings.enabled ? "warning" : (ai24?.calls && ai24.failed / ai24.calls > 0.5) ? "warning" : "on",
        detail: !this.claude.available ? "No API key: built-in rules are used" : !settings.enabled ? "Switched off on Admin → AI" : `${this.claude.model} · ${ai24?.calls ?? 0} calls in 24 h${ai24?.failed ? `, ${ai24.failed} failed` : ""}`,
        setup: "Store the key in the anthropic-key secret" },
      { id: "apish", name: "api.sh (portal imports)", group: "Imports", status: !apish ? "off" : apish.keys.some((k) => k.state === "ok") ? "on" : "warning",
        detail: apish ? `${apish.keys.length} key${apish.keys.length === 1 ? "" : "s"}, ${apish.keys.filter((k) => k.state === "ok").length} working` : "Not set: 99acres and similar links need pasted text", setup: "apish_enabled in Terraform" },
      { id: "brightdata", name: "Bright Data", group: "Imports", status: env.BRIGHTDATA_API_KEY && env.BRIGHTDATA_ZONE ? "on" : "off", detail: env.BRIGHTDATA_ZONE ? `Zone ${env.BRIGHTDATA_ZONE}` : "Not set (optional)", setup: "brightdata_enabled in Terraform" },
      { id: "storage", name: "Google Cloud Storage", group: "Media", status: env.GCS_BUCKET_PUBLIC && env.GCS_BUCKET_UPLOADS ? "on" : "warning", detail: env.GCS_BUCKET_PUBLIC ? `Photos in ${env.GCS_BUCKET_PUBLIC}` : "Files are kept on the server's disk (local only)" },
      { id: "transcoder", name: "Video streaming (Transcoder)", group: "Media", status: env.GCP_PROJECT_ID ? "on" : "off", detail: env.GCP_PROJECT_ID ? "Videos get a streaming version" : "Videos play as uploaded" },
      { id: "tts", name: "Text-to-Speech (podcasts)", group: "Media", status: env.GCP_PROJECT_ID ? "on" : "off", detail: env.GCP_PROJECT_ID ? "Indian English voices for campaign podcasts" : "Podcasts are read by the browser's voice" },
      { id: "smtp", name: "Email (SMTP)", group: "Messaging", status: env.SMTP_HOST && env.EMAIL_FROM ? "on" : "off", detail: env.SMTP_HOST ? `Sign-in codes and alerts from ${env.EMAIL_FROM ?? "?"}` : "No email: sign-in codes can't be sent", setup: "smtp_host in Terraform" },
      { id: "whatsapp", name: "Topsqill WhatsApp number", group: "Messaging", status: env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? "on" : "off", detail: env.WHATSAPP_PHONE_NUMBER_ID ? "Photo inbox and sign-in codes" : "Not set", setup: "whatsapp_enabled in Terraform" },
      { id: "meta", name: "Meta webhooks (app secret)", group: "Messaging", status: env.META_APP_SECRET ? "on" : "off", detail: env.META_APP_SECRET ? "WhatsApp and lead-ad webhooks are checked" : "Webhooks from Meta are refused", setup: "meta-app-secret secret" },
      { id: "instagram", name: "Instagram login", group: "Members' accounts", status: env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET ? "on" : "off", detail: `${counts?.instagram ?? 0} member${counts?.instagram === 1 ? "" : "s"} connected`, setup: "instagram_enabled in Terraform" },
      { id: "wa-business", name: "Members' WhatsApp Business numbers", group: "Members' accounts", status: (counts?.waBusiness ?? 0) > 0 ? "on" : "off", detail: `${counts?.waBusiness ?? 0} connected` },
      { id: "ads-switch", name: "Managed ads", group: "Ads and payments", status: ads.enabled ? "on" : "off", detail: ads.enabled ? `On · fee ${ads.feePct}%` : "Off: members can plan campaigns but not run them", setup: "Admin → Ads" },
      { id: "meta-ads", name: "Meta ads (Facebook, Instagram)", group: "Ads and payments", status: metaTok && ads.meta.adAccountId && ads.meta.pageId ? "on" : metaTok || ads.meta.adAccountId ? "warning" : "off",
        detail: metaTok && ads.meta.adAccountId && ads.meta.pageId ? `Ad account ${ads.meta.adAccountId} · Page ${ads.meta.pageId}` : `Missing: ${[!metaTok && "token", !ads.meta.adAccountId && "ad account", !ads.meta.pageId && "Page"].filter(Boolean).join(", ")}`, setup: "meta-ads-token secret, ids on Admin → Ads" },
      { id: "google-ads", name: "Google Ads (Search)", group: "Ads and payments", status: gDev && gOauth && ads.google.customerId ? "on" : gDev || gOauth || ads.google.customerId ? "warning" : "off",
        detail: gDev && gOauth && ads.google.customerId ? `Account ${ads.google.customerId}` : `Missing: ${[!gDev && "developer token", !gOauth && "OAuth", !ads.google.customerId && "customer id"].filter(Boolean).join(", ")}`, setup: "google-ads-* secrets, ids on Admin → Ads" },
      { id: "razorpay", name: "Razorpay (wallet top-ups)", group: "Ads and payments", status: rpSecret && ads.razorpay.keyId ? (rpHook ? "on" : "warning") : "off",
        detail: rpSecret && ads.razorpay.keyId ? (rpHook ? `Key ${ads.razorpay.keyId.slice(0, 12)}…` : "Webhook secret missing: payments rely on the page confirming") : "Not set: members can't add money", setup: "razorpay-* secrets, key id on Admin → Ads" },
      { id: "lead-sources", name: "Lead sources (webhooks)", group: "Members' accounts", status: (counts?.sources ?? 0) > 0 ? "on" : "off", detail: `${counts?.sources ?? 0} set up` },
    ];
    return { items: c };
  }

  async aiUsage() {
    const res = await this.read.execute(sql`
      select feature,
             count(*)::int                                              as calls,
             count(*) filter (where not ok)::int                        as failed,
             count(*) filter (where created_at::date = now()::date)::int as today,
             coalesce(sum(input_tokens),0)::bigint                      as "inputTokens",
             coalesce(sum(output_tokens),0)::bigint                     as "outputTokens",
             coalesce(round(avg(ms)),0)::int                            as "avgMs",
             count(distinct user_id)::int                               as members
      from ai_usage where created_at > now() - interval '7 days'
      group by feature order by calls desc`);
    const features = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Record<string, number | string>[];
    const daily = await this.read.execute(sql`
      select to_char(d::date, 'YYYY-MM-DD') as day, count(a.id)::int as calls
      from generate_series(now() - interval '6 days', now(), interval '1 day') d
      left join ai_usage a on a.created_at::date = d::date
      group by d order by d`);
    return {
      configured: this.claude.available,
      model: this.claude.model,
      dailyLimitPerMember: Number(process.env.AI_DAILY_LIMIT ?? 200),
      // Imports from sites that block servers (99acres, Housing.com...).
      brightdata: { configured: !!env.BRIGHTDATA_API_KEY && !!env.BRIGHTDATA_ZONE, zone: env.BRIGHTDATA_ZONE ?? null, dailyLimitPerMember: Number(process.env.SCRAPER_DAILY_LIMIT_PER_MEMBER ?? process.env.BRIGHTDATA_DAILY_LIMIT_PER_MEMBER ?? 20) },
      // Which reader opens protected sites: api.sh wins when both are set.
      scraper: apishKeys.configured ? "api.sh" : env.BRIGHTDATA_API_KEY && env.BRIGHTDATA_ZONE ? "Bright Data" : null,
      // Each key by its last four characters only, with whether it is working.
      apishKeys: apishKeys.configured ? await apishKeys.status() : null,
      features: features.map((f) => ({ ...f, inputTokens: Number(f.inputTokens), outputTokens: Number(f.outputTokens) })),
      daily: Array.isArray(daily) ? daily : (daily as { rows: unknown[] }).rows,
    };
  }

  /**
   * The admin's morning brief: yesterday's numbers in a few sentences, with
   * what needs attention first. Written once a day and kept until midnight.
   */
  async aiBrief(adminId: string, refresh = false) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `admin:brief:${day}`;
    if (!refresh) {
      const hit = await this.cache.redis.get(key).catch(() => null);
      if (hit) return JSON.parse(hit);
    }
    const res = await this.read.execute(sql`
      select
        (select count(*) from users where created_at > now() - interval '1 day')::int                         as "newMembers",
        (select count(*) from listings where published_at > now() - interval '1 day')::int                     as "newListings",
        (select count(*) from requirements where created_at > now() - interval '1 day')::int                   as "newRequirements",
        (select count(*) from leads where created_at > now() - interval '1 day')::int                          as "newLeads",
        (select count(*) from messages where created_at > now() - interval '1 day')::int                       as "messages",
        (select count(*) from posts where created_at > now() - interval '1 day')::int                          as "posts",
        (select count(*) from jobs where created_at > now() - interval '1 day')::int                           as "newJobs",
        (select count(*) from verifications where status in ('pending','info'))::int                           as "pendingVerifications",
        (select count(*) from verifications where status in ('pending','info') and created_at < now() - interval '2 days')::int as "verificationsOver2Days",
        (select count(*) from reports where status = 'open')::int                                              as "openReports",
        (select count(*) from media where status = 'failed' and created_at > now() - interval '1 day')::int    as "failedUploads",
        (select count(*) from ai_usage where not ok and created_at > now() - interval '1 day')::int            as "aiFailures",
        (select count(*) from users where created_at between now() - interval '8 days' and now() - interval '1 day')::int as "membersPrior7Days"`);
    const m = (Array.isArray(res) ? res[0] : (res as { rows: unknown[] }).rows[0]) as Record<string, number>;

    const fallback = () => {
      const bullets: string[] = [];
      if (m.verificationsOver2Days) bullets.push(`${m.verificationsOver2Days} verification request${m.verificationsOver2Days === 1 ? " has" : "s have"} waited over 2 days. Review them first.`);
      if (m.openReports) bullets.push(`${m.openReports} open report${m.openReports === 1 ? "" : "s"} to moderate.`);
      bullets.push(`Last 24 hours: ${m.newMembers} new members, ${m.newListings} listings, ${m.newRequirements} requirements, ${m.newLeads} leads, ${m.messages} messages, ${m.posts} posts.`);
      if (m.failedUploads) bullets.push(`${m.failedUploads} uploads failed processing. Check the media worker logs.`);
      if (m.aiFailures) bullets.push(`${m.aiFailures} AI calls failed. Check the API key and quota.`);
      return { bullets };
    };
    const { data, source } = await this.claude.json<{ bullets: string[] }>(
      `You write the daily brief for the admin of Topsqill.ai, an Indian real estate network. From these numbers for the last 24 hours, write 3 to 5 short bullets: what needs action first (old verifications, reports, failures), then growth and activity, with one practical suggestion. Be specific with numbers. No fluff.

NUMBERS: ${JSON.stringify(m)}

Return JSON: {"bullets": ["..."]}`,
      fallback, { userId: adminId, feature: "admin.brief", maxTokens: 600 },
    );
    const brief = { day, bullets: (data.bullets ?? []).slice(0, 6).map(String), metrics: m, source, generatedAt: new Date().toISOString() };
    await this.cache.redis.set(key, JSON.stringify(brief), "EX", 86_400).catch(() => {});
    return brief;
  }

  /* ------------------------ member verification ------------------------ */

  /**
   * A member asks to be verified. Documents are private uploads (never public),
   * stored as "label|mediaId" so reviewers see what each file is. Admins are
   * alerted; the automatic risk checks run straight away.
   */
  async submitVerification(userId: string, input: { kind: "kyc" | "rera"; reraNumber?: string; documents: { label: string; mediaId: string }[] }) {
    if (!input.documents.length) throw new BadRequestException("Upload at least one document.");
    if (input.kind === "rera" && !input.reraNumber?.trim()) throw new BadRequestException("Enter your RERA registration number.");
    const ids = input.documents.map((d) => d.mediaId);
    const files = await this.read.select({ id: media.id, ownerId: media.ownerId, groupName: media.groupName, status: media.status })
      .from(media).where(inArray(media.id, ids));
    if (files.length !== ids.length || files.some((f) => f.ownerId !== userId || f.groupName !== "private" || f.status !== "ready")) {
      throw new BadRequestException("One of the documents is still uploading or could not be found. Please upload it again.");
    }
    const [open] = await this.read.select({ id: verifications.id }).from(verifications)
      .where(and(eq(verifications.userId, userId), eq(verifications.kind, input.kind), inArray(verifications.status, ["pending", "info"]))).limit(1);
    if (open) throw new ConflictException("You already have a request under review. We will let you know soon.");

    if (input.kind === "rera") {
      await this.db.update(users).set({ reraNumber: input.reraNumber!.trim().slice(0, 64), reraVerified: false }).where(eq(users.id, userId));
      await this.cache.redis.del(`profile:${userId}`).catch(() => 0);
    }
    const id = newId();
    const [row] = await this.db.insert(verifications).values({
      id, userId, kind: input.kind, status: "pending",
      documents: input.documents.map((d) => `${d.label.replace(/\|/g, " ").slice(0, 40)}|${d.mediaId}`),
    }).returning();
    await this.riskCheck(id).catch(() => null);

    const admins = await this.read.select({ id: users.id }).from(users).where(and(eq(users.isAdmin, true), eq(users.status, "active"))).limit(20);
    const name = await this.notifs.nameOf(userId);
    for (const a of admins) {
      await this.notifs.create({ userId: a.id, kind: "system", title: `${name} asked for ${input.kind === "rera" ? "RERA" : "KYC"} verification`, actorId: userId, targetType: "verification", targetId: id });
    }
    return row;
  }

  async myVerifications(userId: string) {
    const rows = await this.read.select({ id: verifications.id, kind: verifications.kind, status: verifications.status, note: verifications.note, createdAt: verifications.createdAt, reviewedAt: verifications.reviewedAt })
      .from(verifications).where(eq(verifications.userId, userId)).orderBy(desc(verifications.createdAt)).limit(20);
    return { items: rows };
  }

  /** Short-lived links to a request's documents, for the reviewing admin. */
  async verificationDocuments(verificationId: string) {
    const [v] = await this.read.select({ documents: verifications.documents }).from(verifications).where(eq(verifications.id, verificationId)).limit(1);
    if (!v) throw new NotFoundException("That request could not be found.");
    const out: { label: string; url: string | null; mimeType?: string }[] = [];
    for (const d of v.documents ?? []) {
      const [label, mediaId] = String(d).split("|");
      if (!mediaId) { out.push({ label, url: null }); continue; }
      const link = await this.mediaSvc.privateLink(mediaId).catch(() => null);
      out.push({ label, url: link?.url ?? null, mimeType: link?.mimeType });
    }
    return { items: out };
  }

  /** Numbers for the admin overview. One round trip, not six. */
  async overview() {
    const res = await this.read.execute(sql`
      select
        (select count(*) from users where status = 'active')::int                       as "activeMembers",
        (select count(*) from users where created_at > now() - interval '7 days')::int  as "newThisWeek",
        (select count(*) from verifications where status in ('pending','info'))::int    as "pendingApprovals",
        (select count(*) from listing_reviews where status = 'pending')::int            as "pendingListings",
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

    // Members who joined by email have no phone, so there is nothing to compare.
    let dup = 0;
    if (u?.phone) {
      const dupRes = await this.read.execute(sql`
        select count(*)::int as n from users where phone = ${u.phone} and id <> ${v.userId}`);
      dup = Number((Array.isArray(dupRes) ? dupRes[0] : (dupRes as any).rows[0])?.n ?? 0);
    }
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
    const what = v.kind === "rera" ? "RERA" : "KYC";
    const title = decision === "approved" ? `Your ${what} verification is approved ✓`
      : decision === "rejected" ? `Your ${what} verification was not approved` : `We need a little more for your ${what} verification`;
    await this.notifs.create({ userId: v.userId, kind: "system", title, body: note ?? null, actorId: adminId, targetType: "verification", targetId: v.id });
    await this.notifs.markReadFor(adminId, "verification", v.id);
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
    if (reporterId && input.targetType === "profile" && input.targetId === reporterId) throw new BadRequestException("You can’t report yourself.");
    // The same member reporting the same thing again just gets their open report back.
    const [row] = await this.db.insert(reports).values({ id: newId(), reporterId, ...input }).onConflictDoNothing().returning();
    if (row) return row;
    const [open] = await this.read.select().from(reports)
      .where(and(eq(reports.reporterId, reporterId!), eq(reports.targetType, input.targetType), eq(reports.targetId, input.targetId), eq(reports.status, "open"))).limit(1);
    return open;
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
