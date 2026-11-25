import { Injectable, Inject, Logger, HttpException } from "@nestjs/common";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, ilike, notInArray, or, sql } from "drizzle-orm";
import { DB_READ, type Database } from "../db/db.module";
import { campaigns, campaignRecommendations, leads } from "../db/schema";
import { ClaudeService, textOf } from "../ai/claude.service";
import { CampaignsService } from "./campaigns.service";
import { BusinessService } from "../business/business.service";
import { GenericCampaignsService } from "../business/generic-campaigns.service";
import { ProviderRegistryService, type ProviderStatus } from "../integrations/provider-registry.service";

const VERIFIED_STATUSES = new Set(["connected", "read_verified", "write_verified", "webhook_verified", "production_verified"]);

export type Turn = { role: "user" | "assistant"; text: string };
export type MarketingAssistantReply = { reply: string; source: "claude" | "rules" };

const MAX_TOOL_ROUNDS = 5;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Kept identical between requests, so the API can cache it. */
const SYSTEM = `You are the AI Marketing Orchestrator inside Topsqill, talking to an advertiser about their own ad campaigns, leads and spend.

Topsqill serves more than real estate. Most of your tools cover the real-estate campaign flow (listings, localities, BHK), but a member may also have one or more non-real-estate business profiles with their own industry, recommended objectives and conversion events - use the business tools for those, and never assume a member is a real-estate advertiser just because that flow exists.

Before discussing any advertising, messaging, CRM, analytics or payment platform's capability or performance, call the provider_capabilities tool - never assume or recall from memory which platforms are connected. If a platform's real status there isn't verified/connected, say plainly that Topsqill has no data for it - never estimate or compare a platform you have no integration for.

How to answer:
- Use the tools for any fact about spend, leads, campaigns, platforms, localities, businesses or AI recommendations. Never invent a number, a campaign name, a business name or a lead.
- Distinguish actual results from forecasts explicitly. A forecast or estimate must be labelled as one ("projected", "forecast", "estimate") - never stated as a fact.
- If a tool returns "not enough data yet" for something, say that plainly instead of guessing a number.
- You can explain what a recommendation means and what approving it would do, but you cannot approve, reject or apply it yourself, modify an audience, publish an ad or execute any recommendation - tell the member to use the Approve/Reject buttons on the Insights page.
- Every recommendation has an observation, evidence (which records and period), a likely cause (diagnosis), an expected impact, a confidence level, a risk if acted on, and what approval it needs - use all of these when explaining why AI generated it, not just the headline. The recommendations tool already returns them sorted highest-priority first, so the top of the list IS the answer to "highest priority" or "biggest impact".
- A "stale" recommendation means the situation that raised it no longer holds (it was recalculated and the condition stopped firing) - call the recommendations tool with status "stale" for those.
- Forecasts for a running campaign always come with a data-coverage note (how much live data backs them) - mention it. Forecast accuracy for completed campaigns (forecast vs. what actually happened) is a separate thing - use the forecast_accuracy tool, and never recompute it yourself from raw numbers the tools return.
- You cannot launch a campaign, change a budget, pause a campaign, modify targeting or send any message yourself. If asked to do one of these, say the member needs to do it from the Campaigns page, and explain what you found that's relevant.
- Money in Indian style: ₹2.4 Cr, ₹85 L, ₹45,000. Keep answers under 120 words unless the member asks for a longer breakdown. Plain text, no markdown tables or headings.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_campaigns",
    description: "Every campaign the member owns, with status, spend, leads, qualified leads and cost per qualified lead. Use for 'compare my campaigns', 'which project is doing best', or to find a campaign's id from its name.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "portfolio_overview",
    description: "Cross-campaign totals (spend, leads, qualified), the best-performing platform, best-performing locality and best-performing campaign across the member's whole account, plus how many AI recommendations are pending. Use for 'how much did we spend this month' or 'which locality works best overall'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "campaign_detail",
    description: "Deep dive on one campaign: platform-by-platform spend/qualified split, locality-by-locality lead quality, whether the qualified rate is rising or falling, and a forecast for the rest of the campaign (clearly marked as a forecast). Use for 'why is campaign X's cost per lead going up' or 'how is campaign X doing by area'.",
    input_schema: { type: "object", properties: { campaign_name: { type: "string", description: "The campaign's name, or part of it" } }, required: ["campaign_name"] },
  },
  {
    name: "recommendations",
    description: "AI alerts and suggestions, across all real-estate campaigns (or one, if a name is given), each with its full observation/evidence/diagnosis/recommendation/impact/confidence/risk/approval and sorted highest-priority first. Use for 'what are my top recommendations', 'why did AI suggest this', 'what evidence supports this', 'which are stale' or 'which need my approval'.",
    input_schema: {
      type: "object",
      properties: {
        campaign_name: { type: "string", description: "Optional: limit to one campaign" },
        status: { type: "string", enum: ["pending", "stale", "approved", "rejected", "dismissed"], description: "Defaults to 'pending'. Use 'stale' for recommendations whose underlying situation no longer holds." },
      },
    },
  },
  {
    name: "leads_to_follow_up",
    description: "The member's open (not booked/lost) leads that came from an ad campaign, ranked by lead score, with how long it's been since each was last touched. Use for 'which leads should I follow up with today'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "forecast_accuracy",
    description: "How accurate this member's past pre-launch campaign forecasts turned out to be: qualified-lead count, cost per qualified lead and spend, forecast vs. actual, per completed campaign and on average. Use for 'how accurate have our forecasts been', 'which campaigns beat/missed forecast', 'how accurate were our qualified-lead predictions' or 'how much did spend differ from plan'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "my_businesses",
    description: "The member's non-real-estate business profiles (if any), each with its industry and the objectives/conversion events/dashboard KPIs recommended for that industry. Use when the member asks about a business that isn't real estate, or asks what industries Topsqill supports for them.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "business_marketing_plans",
    description: "The draft marketing plans (objective, conversion event, budget) saved for one of the member's non-real-estate businesses. These are drafts only - Topsqill does not yet launch them to any ad channel.",
    input_schema: { type: "object", properties: { business_name: { type: "string", description: "The business's name, or part of it" } }, required: ["business_name"] },
  },
  {
    name: "provider_capabilities",
    description: "The real, current status of every advertising, messaging, CRM, analytics and payment platform Topsqill can integrate with - what each one actually supports (objectives, placements, bidding, read/write/webhook support) and its verified connection status (not just 'the admin filled in a form'). Always call this before saying whether a platform is connected or comparing platforms.",
    input_schema: { type: "object", properties: {} },
  },
];

/**
 * The AI Marketing Orchestrator's conversational layer (Phase 6, Sections 1 & 7):
 * one chat where a member can ask about their real ad spend, leads and campaign
 * performance in plain language. It never fabricates a number and never takes
 * an action on its own - every tool call reads real rows through the same
 * services the Campaigns pages already use (CampaignsService.dashboard/insights).
 * Without an AI key, or if a call fails, a short rules-based summary answers
 * instead, built from the same portfolio overview.
 */
@Injectable()
export class MarketingAssistantService {
  private readonly log = new Logger("marketing-assistant");

  constructor(
    @Inject(DB_READ) private readonly read: Database,
    private readonly claude: ClaudeService,
    private readonly campaigns: CampaignsService,
    private readonly business: BusinessService,
    private readonly genericCampaigns: GenericCampaignsService,
    private readonly providers: ProviderRegistryService,
  ) {}

  async ask(userId: string, message: string, history: Turn[] = []): Promise<MarketingAssistantReply> {
    if (this.claude.available) {
      try {
        const reply = await this.withClaude(userId, message, history);
        if (reply) return { reply, source: "claude" };
      } catch (e) {
        if (e instanceof HttpException) throw e;   // daily limit
        this.log.warn(`falling back to rules: ${(e as Error).message}`);
      }
    }
    return { reply: await this.withRules(userId), source: "rules" };
  }

  /* ------------------------------ with Claude ------------------------------ */

  private async withClaude(userId: string, message: string, history: Turn[]): Promise<string> {
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const t of tidy(history)) messages.push({ role: t.role, content: t.text });
    messages.push({ role: "user", content: `${message}\n\n(Today is ${new Date().toISOString().slice(0, 10)}.)` });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.claude.chat({
        userId, feature: "marketing-assistant", system: SYSTEM, tools: TOOLS, messages, maxTokens: 1200, effort: "medium",
      });
      messages.push({ role: "assistant", content: res.content });
      if (res.stop_reason !== "tool_use") return textOf(res);

      const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(calls.map(async (c): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const content = await this.runTool(userId, c.name, (c.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: c.id, content };
        } catch (e) {
          return { type: "tool_result", tool_use_id: c.id, content: `Error: ${(e as Error).message}`, is_error: true };
        }
      }));
      messages.push({ role: "user", content: results });
    }
    return "I looked through quite a lot there. Try asking about one campaign specifically.";
  }

  private async runTool(userId: string, name: string, input: Record<string, unknown>): Promise<string> {
    const str = (k: string) => (typeof input[k] === "string" && (input[k] as string).trim() ? (input[k] as string).trim() : undefined);

    switch (name) {
      case "list_campaigns": return this.listCampaignsText(userId);
      case "portfolio_overview": return this.portfolioText(userId);
      case "campaign_detail": {
        const name = str("campaign_name");
        if (!name) return "A campaign name is needed.";
        const c = await this.findCampaignByName(userId, name);
        if (!c) return `No campaign matches "${name}". Use list_campaigns to see real names.`;
        return this.campaignDetailText(userId, c.id);
      }
      case "recommendations": {
        const name = str("campaign_name");
        const id = name ? (await this.findCampaignByName(userId, name))?.id : undefined;
        if (name && !id) return `No campaign matches "${name}".`;
        const status = str("status") ?? "pending";
        return this.recommendationsText(userId, id, status);
      }
      case "leads_to_follow_up": return this.leadsToFollowUpText(userId);
      case "forecast_accuracy": return this.forecastAccuracyText(userId);
      case "my_businesses": return this.myBusinessesText(userId);
      case "business_marketing_plans": {
        const name = str("business_name");
        if (!name) return "A business name is needed.";
        return this.businessPlansText(userId, name);
      }
      case "provider_capabilities": return this.providerCapabilitiesText();
      default: return "Unknown tool.";
    }
  }

  /* --------------------------------- tools --------------------------------- */

  private async findCampaignByName(userId: string, name: string) {
    const [exact] = await this.read.select({ id: campaigns.id, name: campaigns.name }).from(campaigns)
      .where(and(eq(campaigns.ownerId, userId), ilike(campaigns.name, name))).limit(1);
    if (exact) return exact;
    const [near] = await this.read.select({ id: campaigns.id, name: campaigns.name }).from(campaigns)
      .where(and(eq(campaigns.ownerId, userId), ilike(campaigns.name, `%${name.replace(/[%_]/g, "")}%`))).limit(1);
    return near ?? null;
  }

  private async listCampaignsText(userId: string) {
    const { items } = await this.campaigns.list(userId);
    if (!items.length) return "The member has no campaigns yet.";
    return items.map((c) => {
      const qualified = Number(c.qualifiedCount), spend = Number(c.spendInr);
      const cpl = qualified ? `${inr(spend / qualified)}/qualified lead` : "no qualified leads yet";
      return `- ${c.name}: ${c.status}, spend ${inr(spend)}, ${c.leadsCount} leads, ${qualified} qualified, ${cpl}`;
    }).join("\n");
  }

  private async portfolioText(userId: string) {
    const d = await this.campaigns.dashboard(userId);
    const running = d.campaigns.filter((c: { status: string }) => c.status === "active" || c.status === "paused").length;
    const cpl = d.totals.qualified ? inr(d.totals.spendInr / d.totals.qualified) : "not enough qualified leads yet to say";
    const lines = [
      `Campaigns running: ${running} (of ${d.campaigns.length} total).`,
      `Total spend: ${inr(d.totals.spendInr)}. Total leads: ${d.totals.leads}. Qualified: ${d.totals.qualified}. Cost per qualified lead: ${cpl}.`,
      d.bestPlatform ? `Best platform: ${d.bestPlatform.platform} at ${inr(d.bestPlatform.costPerQualifiedLeadInr)}/qualified lead.` : "Best platform: not enough data yet.",
      d.bestLocality ? `Best area: ${d.bestLocality.label}, ${d.bestLocality.qualified}/${d.bestLocality.leads} leads qualified.` : "Best area: not enough data yet.",
      d.bestCampaign ? `Best campaign: ${d.bestCampaign.name} at ${inr(d.bestCampaign.costPerQualifiedLeadInr)}/qualified lead.` : "Best campaign: not enough data yet.",
      `Pending AI recommendations: ${d.pending.length}.`,
    ];
    return lines.join("\n");
  }

  private async campaignDetailText(userId: string, id: string) {
    const c = await this.campaigns.get(userId, id);
    const { metrics, forecast, recommendations } = await this.campaigns.insights(userId, id);
    const lines = [
      `${c.name}: ${c.status}, budget ${inr(Number(c.budgetInr))} over ${c.days} days, spent ${inr(metrics.spendInr)} so far.`,
      `Leads: ${metrics.leadsCount}, qualified: ${metrics.qualifiedCount}${metrics.qualifiedCount ? ` (${inr(metrics.spendInr / metrics.qualifiedCount)}/qualified lead)` : ""}.`,
    ];
    if (metrics.platforms.length) {
      lines.push("By platform: " + metrics.platforms.map((p) => `${p.platform} ${inr(p.spendPaise / 100)} spend, ${p.qualified}/${p.leads} qualified`).join("; "));
    }
    if (metrics.localities.length) {
      lines.push("By area: " + metrics.localities.map((l) => `${l.label} ${l.qualified}/${l.leads} qualified`).join("; "));
    }
    if (metrics.earlyQualifiedRate != null && metrics.recentQualifiedRate != null) {
      const dir = metrics.recentQualifiedRate < metrics.earlyQualifiedRate ? "fallen" : "held up or risen";
      lines.push(`Qualified rate has ${dir}: ${Math.round(metrics.earlyQualifiedRate * 100)}% early vs ${Math.round(metrics.recentQualifiedRate * 100)}% recently.`);
    }
    lines.push(forecast.available
      ? `Forecast for the rest of the campaign (estimate, not a guarantee; ${forecast.dataCoverage}): optimistic ${forecast.optimistic.leads}, realistic ${forecast.realistic.leads}, conservative ${forecast.conservative.leads} total qualified leads.`
      : "Not enough live data yet for a forecast.");
    if (recommendations.length) lines.push(`${recommendations.filter((r) => r.status === "pending").length} AI recommendation(s) pending for this campaign - ask about them specifically if you want detail.`);
    return lines.join("\n");
  }

  /** Joins in the campaign name so "which campaigns have pending recommendations" is answerable from one call. */
  private async recommendationsText(userId: string, campaignId?: string, status = "pending") {
    const conditions = [eq(campaignRecommendations.ownerId, userId), eq(campaignRecommendations.status, status)];
    if (campaignId) conditions.push(eq(campaignRecommendations.campaignId, campaignId));
    const rows = await this.read.select({
      kind: campaignRecommendations.kind, title: campaignRecommendations.title, why: campaignRecommendations.why,
      evidence: campaignRecommendations.evidence, diagnosis: campaignRecommendations.diagnosis,
      impact: campaignRecommendations.impact, confidence: campaignRecommendations.confidence,
      action: campaignRecommendations.action, risk: campaignRecommendations.risk, approval: campaignRecommendations.approval,
      priority: campaignRecommendations.priority, campaignName: campaigns.name,
    }).from(campaignRecommendations).innerJoin(campaigns, eq(campaigns.id, campaignRecommendations.campaignId))
      .where(and(...conditions)).orderBy(desc(campaignRecommendations.priority), desc(campaignRecommendations.createdAt)).limit(20);
    if (!rows.length) return `No ${status} AI recommendations right now${campaignId ? " for this campaign" : ""}.`;
    return rows.map((r) => [
      `- [${r.kind}] ${r.campaignName}: ${r.title}`,
      `  Observation: ${r.why}`,
      r.evidence ? `  Evidence: ${r.evidence}` : null,
      r.diagnosis ? `  Likely cause: ${r.diagnosis}` : null,
      `  Expected impact: ${r.impact} (${r.confidence} confidence)`,
      r.action ? `  Recommended: ${r.action}` : null,
      r.risk ? `  Risk: ${r.risk}` : null,
      r.approval ? `  Approval needed: ${r.approval}` : null,
    ].filter(Boolean).join("\n")).join("\n");
  }

  private async forecastAccuracyText(userId: string) {
    const r = await this.campaigns.forecastAccuracy(userId);
    if (!r.available) return r.reason;
    const lines = [
      `Across ${r.evaluableCount} completed campaign(s) with a usable forecast, average cost-per-qualified-lead error is ${r.averageCostErrorPct != null ? `${r.averageCostErrorPct}%` : "not computable yet"} (how far actual cost per qualified lead was from the forecast, ignoring direction).`,
      ...r.records.map((rec) => {
        const direction = rec.costErrorPct == null ? "" : rec.costErrorPct <= 0 ? ", beat forecast on cost" : ", came in above forecast on cost";
        return `- ${rec.name}: forecast ${rec.forecastQualified} qualified at ${inr(rec.forecastCostPerQualifiedLeadInr)}/lead, actual ${rec.actualQualified} qualified${rec.actualCostPerQualifiedLeadInr != null ? ` at ${inr(rec.actualCostPerQualifiedLeadInr)}/lead` : ""} (${rec.qualifiedErrorPct >= 0 ? "+" : ""}${rec.qualifiedErrorPct}% on qualified count${direction}).`;
      }),
    ];
    return lines.join("\n");
  }

  private async myBusinessesText(userId: string) {
    const { items } = await this.business.list(userId);
    if (!items.length) return "The member has no non-real-estate business profiles yet. They can set one up from the 'Business' button on the Campaigns page.";
    return items.map((b) => {
      const r = b.recommendations;
      return `- ${b.name} (${r.industry.label}): recommended objectives ${r.objectives.join(", ")}; tracks ${r.conversionEvents.join(", ")}; dashboard looks at ${r.dashboardKpis.join(", ")}${r.sensitive ? "; sensitive category, extra ad-policy restrictions apply" : ""}.`;
    }).join("\n");
  }

  private async businessPlansText(userId: string, name: string) {
    const { items: businesses } = await this.business.list(userId);
    const term = name.toLowerCase();
    const match = businesses.find((b) => b.name.toLowerCase() === term) ?? businesses.find((b) => b.name.toLowerCase().includes(term));
    if (!match) return `No business matches "${name}". Use my_businesses to see real names.`;
    const { items } = await this.genericCampaigns.list(userId, match.id);
    if (!items.length) return `${match.name} has no draft marketing plans yet.`;
    return items.map((c) => `- ${c.name} (${match.name}): ${c.objective}, tracking ${c.conversionEvent}, ₹${Number(c.budgetInr).toLocaleString("en-IN")} over ${c.days} days, status ${c.status} (draft only - not launched to any channel).`).join("\n");
  }

  private async providerCapabilitiesText() {
    const rows = await this.providers.registry();
    return rows.map((p) => this.describeProvider(p)).join("\n");
  }

  private describeProvider(p: ProviderStatus) {
    const verified = VERIFIED_STATUSES.has(p.status);
    const head = `- ${p.name} (${p.kind}): status "${p.status}"${verified ? "" : " - NOT usable yet"}.`;
    if (!verified) return `${head} ${p.restrictions}`;
    const bits = [
      p.objectives.length ? `objectives: ${p.objectives.join(", ")}` : null,
      p.placements.length ? `placements: ${p.placements.join(", ")}` : null,
      p.biddingMethods.length ? `bidding: ${p.biddingMethods.join(", ")}` : null,
      p.creativeFormats.length ? `creative formats: ${p.creativeFormats.join(", ")}` : null,
      `conversion tracking: ${p.conversionTracking ? "yes" : "no"}`,
      p.lastSuccessfulSyncAt ? `last successful sync: ${p.lastSuccessfulSyncAt.slice(0, 10)}` : null,
      p.lastError ? `most recent error: ${p.lastError}` : null,
    ].filter(Boolean).join("; ");
    return `${head} ${bits}. ${p.restrictions}`;
  }

  private async leadsToFollowUpText(userId: string) {
    const rows = await this.read.select({
      name: leads.name, stage: leads.stage, score: leads.score, locality: leads.locality,
      budgetMax: leads.budgetMax, lastActivityAt: leads.lastActivityAt, campaignId: leads.campaignId,
    }).from(leads).where(and(
      or(eq(leads.ownerId, userId), eq(leads.assigneeId, userId)),
      notInArray(leads.stage, ["booked", "lost"]),
      sql`${leads.campaignId} is not null`,
    )).orderBy(desc(leads.score)).limit(8);
    if (!rows.length) return "No open ad-sourced leads waiting on follow-up right now.";
    return rows.map((l) => {
      const since = l.lastActivityAt ? `last touched ${l.lastActivityAt.toISOString().slice(0, 10)}` : "never contacted";
      return `- ${l.name}: ${l.stage}, score ${l.score}${l.locality ? `, wants ${l.locality}` : ""}${l.budgetMax ? `, budget up to ${inr(Number(l.budgetMax))}` : ""}, ${since}`;
    }).join("\n");
  }

  /* ---------------------------- without Claude ---------------------------- */

  private async withRules(userId: string) {
    return `Here's your portfolio, without AI (it's off or unavailable right now):\n${await this.portfolioText(userId)}`;
  }
}

function tidy(history: Turn[]) {
  const recent = history.filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-12).map((t) => ({ role: t.role, text: t.text.slice(0, 2000) }));
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}
