import { Injectable, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { queryOn, type Q } from "../ads/db";
import { loadAds } from "../ads/settings";
import { env } from "../common/env";
import { PROVIDER_CAPABILITIES, type ProviderCapability, type CapabilityStatus } from "./provider-capabilities";

export type ProviderStatus = ProviderCapability & {
  status: CapabilityStatus;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
};

/**
 * Universal Connector Capability Registry (Part 22): layers real, derivable
 * runtime signals on top of the static provider-capabilities data -
 *  - Meta/Google: is an ad account/customer ID actually configured
 *    (ads.settings, the same admin-configured row campaigns already launch
 *    through), and do real campaign_deliveries rows show a successful sync
 *    or a recent error?
 *  - WhatsApp: are the real API tokens present in the environment?
 *  - Everything else: stays at its static baseStatus ("unsupported" for
 *    anything with no integration code at all).
 *
 * This replaces guessing at channel availability from a hardcoded list -
 * the AI Marketing Orchestrator calls this before discussing any platform's
 * performance (Part 6/14's "query the registry before proposing
 * provider-specific actions").
 */
@Injectable()
export class ProviderRegistryService {
  private readonly q: Q;

  constructor(@Inject("PG_POOLS") pools: { writePool: Pool }) {
    this.q = queryOn(pools.writePool);
  }

  async registry(): Promise<ProviderStatus[]> {
    const ads = await loadAds(this.q).catch(() => null);
    const sync = await this.q<{ platform: string; last_sync: string | null; last_error: string | null }>(
      `select platform, max(synced_at) as last_sync,
         (array_agg(error order by created_at desc) filter (where error is not null))[1] as last_error
       from campaign_deliveries group by platform`,
    ).catch(() => [] as { platform: string; last_sync: string | null; last_error: string | null }[]);
    const syncByPlatform = new Map(sync.map((s) => [s.platform, s]));

    return PROVIDER_CAPABILITIES.map((p) => {
      const s = syncByPlatform.get(p.id);
      let status: CapabilityStatus = p.baseStatus;

      if (p.id === "meta") status = this.resolveAdPlatform(!!ads?.meta.adAccountId, s);
      else if (p.id === "google") status = this.resolveAdPlatform(!!ads?.google.customerId, s);
      else if (p.id === "whatsapp") status = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? "connected" : "awaiting_credentials";

      return { ...p, status, lastSuccessfulSyncAt: s?.last_sync ?? null, lastError: s?.last_error ?? null };
    });
  }

  private resolveAdPlatform(configured: boolean, s?: { last_sync: string | null; last_error: string | null }): CapabilityStatus {
    if (!configured) return "awaiting_credentials";
    if (s?.last_error && !s.last_sync) return "error";
    if (s?.last_sync) return "production_verified";
    return "connected";
  }
}
