import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { leadSources, ingestEvents, users } from "../db/schema";
import { LeadsService } from "./leads.service";
import { newId } from "../common/ids";
import { env } from "../common/env";
import { parseBudget } from "./parse";

type Normalised = {
  name?: string; phone?: string; email?: string; city?: string; locality?: string;
  budgetMin?: number; budgetMax?: number; timeline?: string; note?: string;
  listingId?: string; sourceDetail?: string; externalId?: string;
};

/**
 * Turns whatever an ad platform or portal sends into one lead shape.
 * Every source posts to the same URL pattern with its own key, so adding a new
 * portal later means adding a parser here, not a new endpoint.
 */
@Injectable()
export class IngestService {
  private readonly log = new Logger("ingest");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly leadsSvc: LeadsService,
  ) {}

  async createSource(ownerId: string, source: string, name: string, config: Record<string, unknown> = {}, assignRule = "owner") {
    const id = newId();
    const ingestKey = randomBytes(18).toString("base64url");
    const [row] = await this.db.insert(leadSources).values({
      id, ownerId, source: source as never, name, config, ingestKey, assignRule,
    }).returning();
    return { ...row, webhookUrl: `${env.CDN_BASE_URL ? "https://api.topsqill.ai" : "http://localhost:8080"}/v1/ingest/${row.source}/${ingestKey}` };
  }

  async listSources(ownerId: string) {
    const rows = await this.read.select().from(leadSources).where(eq(leadSources.ownerId, ownerId)).orderBy(desc(leadSources.createdAt));
    return {
      items: rows.map((r) => ({
        id: r.id, source: r.source, name: r.name, enabled: r.enabled, assignRule: r.assignRule,
        leadCount: r.leadCount, lastEventAt: r.lastEventAt,
        webhookUrl: `/v1/ingest/${r.source}/${r.ingestKey}`,
      })),
    };
  }

  async events(ownerId: string, sourceId: string, limit = 30) {
    const [src] = await this.read.select().from(leadSources)
      .where(and(eq(leadSources.id, sourceId), eq(leadSources.ownerId, ownerId))).limit(1);
    if (!src) throw new NotFoundException("That source could not be found.");
    const rows = await this.read.select().from(ingestEvents)
      .where(eq(ingestEvents.sourceId, sourceId)).orderBy(desc(ingestEvents.createdAt)).limit(Math.min(limit, 100));
    return { items: rows };
  }

  /** Meta signs each webhook. An unsigned or wrongly signed call is rejected. */
  verifyMetaSignature(raw: Buffer, header: string | undefined, appSecret?: string): boolean {
    if (!appSecret) return true;                     // not configured yet (development)
    if (!header?.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
    const a = Buffer.from(header), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handle(sourceKind: string, ingestKey: string, payload: Record<string, unknown>) {
    const [src] = await this.read.select().from(leadSources).where(eq(leadSources.ingestKey, ingestKey)).limit(1);
    if (!src) throw new NotFoundException("Unknown ingest key.");
    if (src.source !== sourceKind) throw new BadRequestException("That key belongs to a different source.");
    if (!src.enabled) return { ok: true, skipped: "source disabled" };

    const eventId = newId();
    try {
      const data = this.parse(sourceKind, payload);
      if (!data) {
        await this.logEvent(eventId, src.id, "received", payload, null, "No lead details in this event");
        return { ok: true, note: "no lead in payload" };
      }
      const assigneeId = await this.pickAssignee(src);
      const { lead, duplicate } = await this.leadsSvc.capture(src.ownerId, {
        ...data, source: sourceKind, assigneeId,
        sourceDetail: data.sourceDetail ?? src.name,
      });
      await this.db.update(leadSources)
        .set({ lastEventAt: new Date(), leadCount: sql`${leadSources.leadCount} + 1` })
        .where(eq(leadSources.id, src.id));
      await this.logEvent(eventId, src.id, duplicate ? "duplicate" : "created", payload, lead.id);
      return { ok: true, leadId: lead.id, duplicate };
    } catch (e) {
      await this.logEvent(eventId, src.id, "failed", payload, null, (e as Error).message.slice(0, 300));
      this.log.error(`ingest failed for ${sourceKind}: ${(e as Error).message}`);
      // Always answer 200 to the platform, or it will retry forever; the failure is recorded here.
      return { ok: true, error: "recorded" };
    }
  }

  /** Round robin keeps one person from receiving every lead. */
  private async pickAssignee(src: typeof leadSources.$inferSelect): Promise<string> {
    if (src.assignRule !== "round_robin") return src.ownerId;
    const team = await this.read.select({ id: users.id }).from(users)
      .where(and(eq(users.agency, sql`(select agency from users where id = ${src.ownerId})`), eq(users.status, "active")))
      .limit(20);
    if (team.length < 2) return src.ownerId;
    const idx = src.leadCount % team.length;
    return team[idx].id;
  }

  private async logEvent(id: string, sourceId: string, status: string, payload: unknown, leadId: string | null, error?: string) {
    await this.db.insert(ingestEvents).values({ id, sourceId, status, payload: payload as never, leadId, error });
  }

  /* ------------------------- one parser per source ------------------------- */

  private parse(kind: string, p: Record<string, any>): Normalised | null {
    switch (kind) {
      case "meta": return this.parseMeta(p);
      case "google": return this.parseGoogle(p);
      case "linkedin": return this.parseLinkedIn(p);
      case "portal_99acres":
      case "portal_magicbricks":
      case "portal_housing": return this.parsePortal(p);
      case "call": return this.parseCall(p);
      default: return this.parseGeneric(p);
    }
  }

  /**
   * Meta's webhook carries only ids; the full answers come from the Graph API.
   * Both shapes are handled: the raw webhook, and the enriched record a worker fetches.
   */
  private parseMeta(p: Record<string, any>): Normalised | null {
    const change = p?.entry?.[0]?.changes?.[0]?.value;
    if (change?.leadgen_id && !p.field_data) {
      return { externalId: String(change.leadgen_id), name: "Pending enrichment", sourceDetail: change.form_id ? `Form ${change.form_id}` : undefined };
    }
    const fields: Record<string, string> = {};
    for (const f of p.field_data ?? []) fields[String(f.name).toLowerCase()] = f.values?.[0] ?? "";
    if (!Object.keys(fields).length) return null;
    return {
      externalId: p.id ? String(p.id) : undefined,
      name: fields.full_name || [fields.first_name, fields.last_name].filter(Boolean).join(" ") || undefined,
      phone: fields.phone_number || fields.phone,
      email: fields.email,
      city: fields.city, locality: fields.locality || fields.preferred_location,
      budgetMax: parseBudget(fields.budget),
      timeline: fields.timeline || fields.when_are_you_planning_to_move,
      note: fields.message,
      sourceDetail: p.campaign_name || p.ad_name || p.form_name,
    };
  }

  private parseGoogle(p: Record<string, any>): Normalised | null {
    const col: Record<string, string> = {};
    for (const c of p.user_column_data ?? []) col[String(c.column_id).toUpperCase()] = c.string_value ?? "";
    if (!Object.keys(col).length) return this.parseGeneric(p);
    return {
      externalId: p.lead_id ? String(p.lead_id) : undefined,
      name: [col.FIRST_NAME, col.LAST_NAME].filter(Boolean).join(" ") || col.FULL_NAME,
      phone: col.PHONE_NUMBER, email: col.EMAIL, city: col.CITY,
      note: col.MESSAGE, sourceDetail: p.campaign_id ? `Campaign ${p.campaign_id}` : undefined,
    };
  }

  private parseLinkedIn(p: Record<string, any>): Normalised | null {
    const a: Record<string, string> = {};
    for (const f of p.formResponse?.answers ?? p.answers ?? []) a[String(f.questionId ?? f.name).toLowerCase()] = f.answerDetails?.textQuestionAnswer?.answer ?? f.value ?? "";
    if (!Object.keys(a).length) return this.parseGeneric(p);
    return {
      externalId: p.id ? String(p.id) : undefined,
      name: [a.firstname, a.lastname].filter(Boolean).join(" ") || a.fullname,
      phone: a.phonenumber || a.phone, email: a.emailaddress || a.email,
      city: a.city, sourceDetail: p.campaign ? String(p.campaign) : "LinkedIn lead form",
    };
  }

  /** Portals mostly post flat JSON, or forward an email that a worker has parsed. */
  private parsePortal(p: Record<string, any>): Normalised | null {
    const name = p.name ?? p.customer_name ?? p.contactName ?? p.sender_name;
    const phone = p.phone ?? p.mobile ?? p.contact_no ?? p.contactNumber;
    if (!name && !phone) return null;
    return {
      externalId: p.enquiry_id ?? p.lead_id ?? p.id,
      name, phone, email: p.email ?? p.emailId,
      city: p.city, locality: p.locality ?? p.project ?? p.property_locality,
      budgetMax: parseBudget(p.budget),
      note: p.message ?? p.requirement, listingId: p.listing_id ?? p.listingId,
      sourceDetail: p.project_name ?? p.property_title,
    };
  }

  private parseCall(p: Record<string, any>): Normalised | null {
    const phone = p.CallFrom ?? p.caller ?? p.from ?? p.phone;
    if (!phone) return null;
    return {
      externalId: p.CallSid ?? p.call_id, name: p.name ?? "Caller", phone,
      note: p.RecordingUrl ? `Call recording: ${p.RecordingUrl}` : "Inbound call",
      sourceDetail: p.To ? `Virtual number ${p.To}` : undefined,
    };
  }

  private parseGeneric(p: Record<string, any>): Normalised | null {
    const name = p.name ?? p.fullName ?? p.full_name;
    const phone = p.phone ?? p.mobile ?? p.phoneNumber;
    if (!name && !phone) return null;
    return {
      name, phone, email: p.email, city: p.city, locality: p.locality,
      budgetMin: Number(p.budgetMin) || undefined, budgetMax: parseBudget(p.budget) ?? (Number(p.budgetMax) || undefined),
      timeline: p.timeline, note: p.message ?? p.note, listingId: p.listingId, externalId: p.externalId,
    };
  }
}
