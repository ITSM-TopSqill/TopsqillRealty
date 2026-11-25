import { Injectable, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { campaignEvolutions } from "../db/schema";
import { CampaignsService } from "../campaigns/campaigns.service";
import { BusinessService } from "../business/business.service";
import { CustomerIntelligenceService } from "../customer-intelligence/customer-intelligence.service";
import { ProviderRegistryService } from "../integrations/provider-registry.service";

const VERIFIED = new Set(["connected", "read_verified", "write_verified", "webhook_verified", "production_verified"]);

/**
 * AI Marketing Command Centre (Universal spec Part 19 / Campaign Evolution
 * spec Section 14): a single real-data aggregation over everything already
 * built - no new calculations, no invented metrics. Every number here is
 * read straight from the service that already owns it (CampaignsService,
 * BusinessService, CustomerIntelligenceService, ProviderRegistryService,
 * and this campaign_evolutions table directly, since it already carries
 * ownerId).
 */
@Injectable()
export class CommandCentreService {
  constructor(
    @Inject(DB_READ) private readonly read: Database,
    private readonly campaigns: CampaignsService,
    private readonly business: BusinessService,
    private readonly customerIntel: CustomerIntelligenceService,
    private readonly providers: ProviderRegistryService,
  ) {}

  async overview(userId: string) {
    const [dashboard, forecastAccuracy, businesses, segments, registry, evolution] = await Promise.all([
      this.campaigns.dashboard(userId),
      this.campaigns.forecastAccuracy(userId),
      this.business.list(userId),
      this.customerIntel.list(userId),
      this.providers.registry(),
      this.evolutionSummary(userId),
    ]);

    const running = dashboard.campaigns.filter((c) => c.status === "active" || c.status === "paused").length;
    const verifiedProviders = registry.filter((p) => VERIFIED.has(p.status));

    return {
      businessOverview: {
        campaignsRunning: running, campaignsTotal: dashboard.campaigns.length,
        totalSpendInr: dashboard.totals.spendInr, totalLeads: dashboard.totals.leads, totalQualified: dashboard.totals.qualified,
        bestPlatform: dashboard.bestPlatform, bestLocality: dashboard.bestLocality, bestCampaign: dashboard.bestCampaign,
      },
      forecastAccuracy,
      growthOpportunities: dashboard.pending.slice(0, 5),
      approvalCentre: { pendingRecommendations: dashboard.pending.length, pendingEvolutionChanges: evolution.pendingChanges },
      aiActivity: {
        recommendationsPending: dashboard.pending.length,
        evolutionAnalysesRun: evolution.analysesRun, evolutionVersionsApplied: evolution.versionsApplied,
      },
      integrations: {
        connectedCount: verifiedProviders.length, totalCount: registry.length,
        details: registry.map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: p.status })),
      },
      nonRealEstateBusinesses: {
        count: businesses.items.length,
        items: businesses.items.map((b) => ({ id: b.id, name: b.name, industry: b.recommendations.industry.label })),
      },
      customerSegments: { count: segments.items.length, items: segments.items.map((s) => ({ id: s.id, name: s.name })) },
    };
  }

  private async evolutionSummary(userId: string) {
    const rows = await this.read.select().from(campaignEvolutions).where(eq(campaignEvolutions.ownerId, userId));
    let versionsApplied = 0, pendingChanges = 0;
    for (const r of rows) {
      if (r.status === "applied") versionsApplied++;
      const versions = r.versions as unknown as { changes: { id: string }[] }[];
      const decisions = r.decisions as Record<string, string>;
      for (const v of versions) for (const c of v.changes) if (!decisions[c.id]) pendingChanges++;
    }
    return { analysesRun: rows.length, versionsApplied, pendingChanges };
  }
}
