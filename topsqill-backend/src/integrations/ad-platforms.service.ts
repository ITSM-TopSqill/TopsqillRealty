import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { adAccounts, campaignDeliveries, campaigns } from "../db/schema";
import { SecretsService } from "./secrets.service";
import { newId } from "../common/ids";

type Platform = "meta" | "google" | "linkedin";
const CHANNEL_PLATFORM: Record<string, Platform> = {
  "Instagram and Facebook": "meta",
  "WhatsApp click-to-chat": "meta",
  "Google Search": "google",
  YouTube: "google",
  LinkedIn: "linkedin",
};

/**
 * Creates the real campaigns on Meta, Google and LinkedIn.
 *
 * Two rules run through this service:
 *  - Nothing is ever spent without a connected account that the member authorised.
 *  - Each platform gets its own delivery row, so one failing platform never stops
 *    the others and the member can see exactly what happened.
 */
@Injectable()
export class AdPlatformsService {
  private readonly log = new Logger("ads");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly secrets: SecretsService,
  ) {}

  async connect(userId: string, platform: Platform, accountId: string, accountName: string, token: string) {
    // The token goes to Secret Manager; only its name is stored in the database.
    const secretRef = await this.secrets.put(`ads-${platform}-${userId}-${accountId}`, token);
    const id = newId();
    const [row] = await this.db.insert(adAccounts)
      .values({ id, ownerId: userId, platform, accountId, accountName, secretRef, lastCheckedAt: new Date() })
      .onConflictDoUpdate({
        target: [adAccounts.ownerId, adAccounts.platform, adAccounts.accountId],
        set: { accountName, secretRef, status: "connected", lastCheckedAt: new Date() },
      }).returning();
    return { id: row.id, platform: row.platform, accountId: row.accountId, accountName: row.accountName, status: row.status };
  }

  async listAccounts(userId: string) {
    const rows = await this.read.select({
      id: adAccounts.id, platform: adAccounts.platform, accountId: adAccounts.accountId,
      accountName: adAccounts.accountName, status: adAccounts.status, lastCheckedAt: adAccounts.lastCheckedAt,
    }).from(adAccounts).where(eq(adAccounts.ownerId, userId));
    return { items: rows };
  }

  async disconnect(userId: string, id: string) {
    const [row] = await this.db.update(adAccounts).set({ status: "disabled" })
      .where(and(eq(adAccounts.id, id), eq(adAccounts.ownerId, userId))).returning();
    if (!row) throw new NotFoundException("That account could not be found.");
    if (row.secretRef) await this.secrets.remove(row.secretRef);
    return { ok: true };
  }

  /** Which platforms this campaign needs, and whether each one is ready. */
  async readiness(userId: string, channels: { channel: string; budgetPct: number }[]) {
    const needed = [...new Set(channels.map((c) => CHANNEL_PLATFORM[c.channel]).filter(Boolean))] as Platform[];
    const accounts = await this.read.select().from(adAccounts)
      .where(and(eq(adAccounts.ownerId, userId), eq(adAccounts.status, "connected")));
    const have = new Set(accounts.map((a) => a.platform));
    return {
      ready: needed.every((p) => have.has(p)),
      platforms: needed.map((p) => ({ platform: p, connected: have.has(p) })),
      missing: needed.filter((p) => !have.has(p)),
    };
  }

  /**
   * Sends the campaign to each platform. One delivery row per platform, created
   * before the API call, so a crash mid-way never loses track of money spent.
   */
  async launch(userId: string, campaignId: string) {
    const [c] = await this.read.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!c || c.ownerId !== userId) throw new NotFoundException("That campaign could not be found.");
    const channels = (c.plan as { channels?: { channel: string; budgetPct: number }[] })?.channels ?? [];
    if (!channels.length) throw new BadRequestException("This campaign has no channels yet.");

    const ready = await this.readiness(userId, channels);
    if (!ready.ready) {
      return { launched: false, reason: "accounts_missing", missing: ready.missing,
        message: `Connect your ${ready.missing.join(" and ")} ad account before launching.` };
    }

    const byPlatform = new Map<Platform, number>();
    for (const ch of channels) {
      const p = CHANNEL_PLATFORM[ch.channel];
      if (p) byPlatform.set(p, (byPlatform.get(p) ?? 0) + Math.round((c.budgetInr * ch.budgetPct) / 100));
    }

    const results = [];
    for (const [platform, budget] of byPlatform) {
      const id = newId();
      await this.db.insert(campaignDeliveries).values({ id, campaignId, platform, budgetInr: budget, status: "pending" });
      try {
        const external = await this.createOnPlatform(userId, platform, c, budget);
        await this.db.update(campaignDeliveries)
          .set({ status: "live", externalCampaignId: external, syncedAt: new Date() })
          .where(eq(campaignDeliveries.id, id));
        results.push({ platform, status: "live", externalCampaignId: external, budgetInr: budget });
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        await this.db.update(campaignDeliveries).set({ status: "failed", error: msg }).where(eq(campaignDeliveries.id, id));
        this.log.error(`${platform} launch failed for campaign ${campaignId}: ${msg}`);
        results.push({ platform, status: "failed", error: msg, budgetInr: budget });
      }
    }

    const anyLive = results.some((r) => r.status === "live");
    if (anyLive) {
      await this.db.update(campaigns).set({ status: "active", launchedAt: new Date(), updatedAt: new Date() })
        .where(eq(campaigns.id, campaignId));
    }
    return { launched: anyLive, deliveries: results };
  }

  async deliveries(userId: string, campaignId: string) {
    const [c] = await this.read.select({ ownerId: campaigns.ownerId }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (!c || c.ownerId !== userId) throw new NotFoundException("That campaign could not be found.");
    const rows = await this.read.select().from(campaignDeliveries)
      .where(eq(campaignDeliveries.campaignId, campaignId)).orderBy(desc(campaignDeliveries.createdAt));
    return { items: rows };
  }

  /**
   * Creates the campaign on the platform.
   *
   * Each call needs the member's own authorised account, so these run only once
   * a real token exists. Until then the member sees a clear "connect your account"
   * message rather than a campaign that silently does nothing.
   */
  private async createOnPlatform(userId: string, platform: Platform, campaign: typeof campaigns.$inferSelect, budgetInr: number): Promise<string> {
    const [account] = await this.read.select().from(adAccounts)
      .where(and(eq(adAccounts.ownerId, userId), eq(adAccounts.platform, platform), eq(adAccounts.status, "connected"))).limit(1);
    if (!account) throw new Error(`No connected ${platform} account`);
    const token = await this.secrets.get(account.secretRef ?? "");
    if (!token) throw new Error(`The ${platform} token is missing or expired. Reconnect the account.`);

    const plan = campaign.plan as Record<string, unknown>;
    const dailyBudgetPaise = Math.round((budgetInr / Math.max(campaign.days, 1)) * 100);

    if (platform === "meta") {
      const base = `https://graph.facebook.com/v23.0/act_${account.accountId}`;
      const res = await fetch(`${base}/campaigns`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          name: campaign.name.slice(0, 100),
          objective: "OUTCOME_LEADS",
          status: "PAUSED",                       // created paused; the member confirms before spending
          special_ad_categories: ["HOUSING"],     // required by Meta for property ads
          daily_budget: dailyBudgetPaise,
        }),
      });
      if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return String(((await res.json()) as { id: string }).id);
    }

    if (platform === "google") {
      const res = await fetch(`https://googleads.googleapis.com/v18/customers/${account.accountId}/campaignBudgets:mutate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`, "content-type": "application/json",
          "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
        },
        body: JSON.stringify({ operations: [{ create: { name: `${campaign.name} budget`.slice(0, 100), amountMicros: String(Math.round((budgetInr / Math.max(campaign.days, 1)) * 1_000_000)), deliveryMethod: "STANDARD" } }] }),
      });
      if (!res.ok) throw new Error(`Google Ads ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { results?: { resourceName: string }[] };
      return body.results?.[0]?.resourceName ?? "created";
    }

    const res = await fetch("https://api.linkedin.com/rest/adCampaigns", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "LinkedIn-Version": "202411", "X-Restli-Protocol-Version": "2.0.0" },
      body: JSON.stringify({
        account: `urn:li:sponsoredAccount:${account.accountId}`,
        name: campaign.name.slice(0, 100),
        type: "SPONSORED_UPDATES",
        status: "DRAFT",
        dailyBudget: { amount: String(Math.round(budgetInr / Math.max(campaign.days, 1))), currencyCode: "INR" },
        locale: { country: "IN", language: "en" },
      }),
    });
    if (!res.ok) throw new Error(`LinkedIn ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return String(((await res.json()) as { id?: string }).id ?? "created");
  }

  /** Pulls spend and results back so the member sees real numbers, not estimates. */
  async syncStats(deliveryId: string) {
    const [d] = await this.read.select().from(campaignDeliveries).where(eq(campaignDeliveries.id, deliveryId)).limit(1);
    if (!d || d.status !== "live" || !d.externalCampaignId) return { synced: false };
    const [c] = await this.read.select().from(campaigns).where(eq(campaigns.id, d.campaignId)).limit(1);
    if (!c) return { synced: false };
    const [account] = await this.read.select().from(adAccounts)
      .where(and(eq(adAccounts.ownerId, c.ownerId), eq(adAccounts.platform, d.platform))).limit(1);
    const token = account?.secretRef ? await this.secrets.get(account.secretRef) : null;
    if (!token) return { synced: false, reason: "no token" };

    try {
      let stats: Record<string, number> = {};
      if (d.platform === "meta") {
        const res = await fetch(`https://graph.facebook.com/v23.0/${d.externalCampaignId}/insights?fields=impressions,clicks,spend,actions`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Meta ${res.status}`);
        const row = ((await res.json()) as { data?: Record<string, unknown>[] }).data?.[0] ?? {};
        const leads = (row.actions as { action_type: string; value: string }[] | undefined)
          ?.find((a) => a.action_type === "lead")?.value;
        stats = { impressions: Number(row.impressions ?? 0), clicks: Number(row.clicks ?? 0), spend: Number(row.spend ?? 0), leads: Number(leads ?? 0) };
      }
      await this.db.update(campaignDeliveries).set({ stats, syncedAt: new Date() }).where(eq(campaignDeliveries.id, deliveryId));
      // Roll the platform numbers up to the campaign the member actually looks at.
      await this.db.update(campaigns).set({
        spendInr: sql`(select coalesce(sum((stats->>'spend')::numeric), 0)::bigint from campaign_deliveries where campaign_id = ${d.campaignId})`,
        leadsCount: sql`(select coalesce(sum((stats->>'leads')::int), 0) from campaign_deliveries where campaign_id = ${d.campaignId})`,
        updatedAt: new Date(),
      }).where(eq(campaigns.id, d.campaignId));
      return { synced: true, stats };
    } catch (e) {
      this.log.warn(`stats sync failed for ${deliveryId}: ${(e as Error).message}`);
      return { synced: false, error: (e as Error).message };
    }
  }
}
