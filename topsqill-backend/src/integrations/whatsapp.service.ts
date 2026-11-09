import { Injectable, Inject, Logger, BadRequestException, NotFoundException, ConflictException } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DB, DB_READ, type Database } from "../db/db.module";
import { whatsappAccounts, whatsappMessages, whatsappOptins, leads } from "../db/schema";
import { SecretsService } from "./secrets.service";
import { LeadsService } from "../leads/leads.service";
import { newId } from "../common/ids";
import { normalisePhone } from "../auth/phone";

const GRAPH = (v = "v23.0") => `https://graph.facebook.com/${v}`;
const TAKEN = "This WhatsApp number is already connected to another Topsqill.ai account.";

/**
 * Sending on WhatsApp.
 *
 * Two rules are enforced here rather than left to the caller, because getting
 * them wrong gets a business number banned:
 *  - Nothing is sent to someone who has not opted in, or who has opted out.
 *  - Outside the 24-hour window, only approved templates may be used.
 */
@Injectable()
export class WhatsAppService {
  private readonly log = new Logger("whatsapp");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(DB_READ) private readonly read: Database,
    private readonly secrets: SecretsService,
    private readonly leadsSvc: LeadsService,
  ) {}

  /**
   * Connects a WhatsApp Business number, or refreshes the member's own token.
   * A number already connected by someone else is refused: overwriting its
   * token would let one member take over another's number and conversations.
   */
  async connect(userId: string, input: { wabaId: string; phoneNumberId: string; displayNumber?: string; token: string }) {
    const [existing] = await this.db.select({ ownerId: whatsappAccounts.ownerId }).from(whatsappAccounts)
      .where(eq(whatsappAccounts.phoneNumberId, input.phoneNumberId)).limit(1);
    if (existing && existing.ownerId !== userId) throw new ConflictException(TAKEN);

    const secretRef = await this.secrets.put(`wa-${userId}-${input.phoneNumberId}`, input.token);
    const id = newId();
    const [row] = await this.db.insert(whatsappAccounts)
      .values({ id, ownerId: userId, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId, displayNumber: input.displayNumber, secretRef })
      .onConflictDoUpdate({
        target: whatsappAccounts.phoneNumberId,
        set: { wabaId: input.wabaId, secretRef, status: "connected" },
        // Covers the race where someone else connects the number between the check and here.
        setWhere: eq(whatsappAccounts.ownerId, userId),
      })
      .returning();
    if (!row) throw new ConflictException(TAKEN);
    return { id: row.id, phoneNumberId: row.phoneNumberId, displayNumber: row.displayNumber, status: row.status };
  }

  async account(userId: string) {
    const [row] = await this.read.select().from(whatsappAccounts)
      .where(and(eq(whatsappAccounts.ownerId, userId), eq(whatsappAccounts.status, "connected"))).limit(1);
    return row ?? null;
  }

  async recordOptIn(userId: string, phoneRaw: string, source: string, proof?: string) {
    const phone = normalisePhone(phoneRaw);
    if (!phone) throw new BadRequestException("Enter a valid mobile number.");
    await this.db.insert(whatsappOptins).values({ ownerId: userId, phone, source, proof })
      .onConflictDoUpdate({ target: [whatsappOptins.ownerId, whatsappOptins.phone], set: { source, proof, optedOutAt: null } });
    return { ok: true };
  }

  async optOut(userId: string, phoneRaw: string) {
    const phone = normalisePhone(phoneRaw);
    if (!phone) return { ok: false };
    await this.db.update(whatsappOptins).set({ optedOutAt: new Date() })
      .where(and(eq(whatsappOptins.ownerId, userId), eq(whatsappOptins.phone, phone)));
    return { ok: true };
  }

  async hasOptIn(userId: string, phone: string) {
    const [row] = await this.read.select().from(whatsappOptins)
      .where(and(eq(whatsappOptins.ownerId, userId), eq(whatsappOptins.phone, phone), isNull(whatsappOptins.optedOutAt))).limit(1);
    return !!row;
  }

  /** True when the person messaged us in the last 24 hours, so free-form text is allowed. */
  async withinServiceWindow(userId: string, phone: string) {
    const [row] = await this.read.select({ createdAt: whatsappMessages.createdAt }).from(whatsappMessages)
      .where(and(eq(whatsappMessages.ownerId, userId), eq(whatsappMessages.toNumber, phone), eq(whatsappMessages.direction, "in")))
      .orderBy(desc(whatsappMessages.createdAt)).limit(1);
    return !!row && Date.now() - row.createdAt.getTime() < 24 * 3600 * 1000;
  }

  async send(userId: string, input: { to: string; body?: string; template?: string; templateParams?: string[]; leadId?: string }) {
    const phone = normalisePhone(input.to);
    if (!phone) throw new BadRequestException("Enter a valid mobile number.");

    const account = await this.account(userId);
    if (!account) throw new BadRequestException("Connect your WhatsApp Business number first.");
    if (!(await this.hasOptIn(userId, phone))) {
      throw new BadRequestException("This person has not opted in to WhatsApp messages, or has opted out.");
    }
    const open = await this.withinServiceWindow(userId, phone);
    if (!open && !input.template) {
      throw new BadRequestException("It has been more than 24 hours since they last messaged you, so you can only send an approved template.");
    }

    const id = newId();
    await this.db.insert(whatsappMessages).values({
      id, ownerId: userId, leadId: input.leadId ?? null, toNumber: phone, direction: "out",
      template: input.template ?? null, body: input.body ?? null, status: "queued",
    });

    try {
      const token = await this.secrets.get(account.secretRef ?? "");
      if (!token) throw new Error("The WhatsApp token is missing. Reconnect the number.");
      const payload = input.template
        ? { messaging_product: "whatsapp", to: phone.replace("+", ""), type: "template",
            template: { name: input.template, language: { code: "en" },
              components: input.templateParams?.length ? [{ type: "body", parameters: input.templateParams.map((t) => ({ type: "text", text: t })) }] : [] } }
        : { messaging_product: "whatsapp", to: phone.replace("+", ""), type: "text", text: { preview_url: true, body: input.body } };

      const res = await fetch(`${GRAPH()}/${account.phoneNumberId}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { messages?: { id: string }[] };
      const wamid = body.messages?.[0]?.id ?? null;
      await this.db.update(whatsappMessages).set({ status: "sent", wamid }).where(eq(whatsappMessages.id, id));
      if (input.leadId) await this.leadsSvc.addActivity(input.leadId, userId, "whatsapp", input.body ?? `Template: ${input.template}`);
      return { id, status: "sent", wamid };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await this.db.update(whatsappMessages).set({ status: "failed", error: msg }).where(eq(whatsappMessages.id, id));
      this.log.error(`send failed: ${msg}`);
      throw new BadRequestException(`The message could not be sent. ${msg}`);
    }
  }

  /**
   * Incoming webhook: messages become leads and activities, and status updates
   * (delivered, read, failed) are written back against the sent message.
   */
  async handleWebhook(userId: string | null, payload: Record<string, any>) {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    if (!value) return { ok: true };

    const phoneNumberId = value.metadata?.phone_number_id;
    let ownerId = userId;
    if (!ownerId && phoneNumberId) {
      const [acct] = await this.read.select({ ownerId: whatsappAccounts.ownerId }).from(whatsappAccounts)
        .where(eq(whatsappAccounts.phoneNumberId, String(phoneNumberId))).limit(1);
      ownerId = acct?.ownerId ?? null;
    }
    if (!ownerId) return { ok: true, note: "unknown number" };

    for (const s of value.statuses ?? []) {
      await this.db.update(whatsappMessages)
        .set({ status: String(s.status), error: s.errors?.[0]?.title?.slice(0, 300) ?? null })
        .where(eq(whatsappMessages.wamid, String(s.id)));
    }

    for (const m of value.messages ?? []) {
      const from = normalisePhone(String(m.from));
      if (!from) continue;
      const body = m.text?.body ?? m[m.type]?.caption ?? `(${m.type})`;
      await this.db.insert(whatsappMessages).values({
        id: newId(), ownerId, toNumber: from, direction: "in", body, wamid: String(m.id), status: "delivered",
      }).onConflictDoNothing();

      // Messaging us first is itself consent to reply.
      await this.recordOptIn(ownerId, from, "chat", "Person messaged the business first").catch(() => {});
      if (/^\s*(stop|unsubscribe|band karo)\s*$/i.test(body)) {
        await this.optOut(ownerId, from);
        continue;
      }

      const [existing] = await this.read.select({ id: leads.id }).from(leads)
        .where(and(eq(leads.ownerId, ownerId), eq(leads.phone, from))).orderBy(desc(leads.createdAt)).limit(1);
      if (existing) await this.leadsSvc.addActivity(existing.id, null, "whatsapp", body);
      else await this.leadsSvc.capture(ownerId, { name: value.contacts?.[0]?.profile?.name ?? "WhatsApp enquiry", phone: from, source: "whatsapp", note: body, otpVerified: true });
    }
    return { ok: true };
  }

  async history(userId: string, leadId: string) {
    const rows = await this.read.select().from(whatsappMessages)
      .where(and(eq(whatsappMessages.ownerId, userId), eq(whatsappMessages.leadId, leadId)))
      .orderBy(desc(whatsappMessages.createdAt)).limit(100);
    return { items: rows };
  }
}
