import { Injectable, Inject, BadRequestException, NotFoundException, ForbiddenException, ServiceUnavailableException, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { NotificationsService } from "../notifications/notifications.service";
import { LeadsService } from "../leads/leads.service";
import { inTx, queryOn, type Q } from "./db";
import { ledger, InsufficientFunds, rupees } from "./ledger";
import { loadAds, forgetAds, normaliseAds, type AdsSettings } from "./settings";
import { adsSecret, clearAdsSecrets, ADS_SECRET_NAMES, secretId } from "./secrets";
import { createOrder, checkoutSignatureOk, webhookSignatureOk, checkKeys } from "./razorpay";
import { launchCampaign, setLive, syncCampaign, endCampaign, readyPlatforms, metaCtx, googleCtx, type Notify } from "./runner";
import { metaCheck, metaLead } from "./meta";
import { googleCheck } from "./google";

type Row = Record<string, any>;

/**
 * Managed ads: members pay into a prepaid wallet (Razorpay), set up a
 * campaign, and submit it. The budget (plus Topsqill's fee) is set aside;
 * an admin reviews it; on approval it's created on Topsqill's Meta and
 * Google ad accounts. Spend is charged as it happens, leads from the ad's
 * form go straight to the member's Leads, and whatever isn't spent goes back
 * to the wallet when the campaign ends.
 */
@Injectable()
export class AdsService {
  private readonly log = new Logger("ads");
  private readonly pool: Pool;
  private readonly q: Q;

  constructor(
    @Inject("PG_POOLS") pools: { writePool: Pool },
    private readonly notifs: NotificationsService,
    private readonly leads: LeadsService,
  ) {
    this.pool = pools.writePool;
    this.q = queryOn(this.pool);
  }

  readonly notify: Notify = (n) => this.notifs.create({ userId: n.userId, kind: "campaign", title: n.title, body: n.body, targetType: n.targetType, targetId: n.targetId });

  private async admins() {
    return this.q<{ id: string }>("select id from users where is_admin and status = 'active' limit 50");
  }

  /* --------------------------------- wallet --------------------------------- */

  async wallet(userId: string) {
    const s = await loadAds(this.q);
    const [w, txns, pays, rp] = await Promise.all([
      ledger.balance(this.q, userId),
      this.q(`select t.id, t.kind, t.amount_paise as "amountPaise", t.balance_after as "balanceAfter", t.held_after as "heldAfter", t.note, t.created_at as "createdAt",
                     t.campaign_id as "campaignId", c.name as "campaignName"
                from wallet_txns t left join campaigns c on c.id = t.campaign_id where t.owner_id = $1 order by t.created_at desc limit 100`, [userId]),
      this.q(`select id, amount_paise as "amountPaise", gst_paise as "gstPaise", total_paise as "totalPaise", status, invoice_no as "invoiceNo", created_at as "createdAt", paid_at as "paidAt"
                from payments where owner_id = $1 and status = 'paid' order by created_at desc limit 50`, [userId]),
      adsSecret("razorpay-key-secret"),
    ]);
    return {
      ...w,
      txns: txns.map((t) => ({ ...t, amountPaise: Number(t.amountPaise), balanceAfter: Number(t.balanceAfter), heldAfter: Number(t.heldAfter) })),
      payments: pays.map((p) => ({ ...p, amountPaise: Number(p.amountPaise), gstPaise: Number(p.gstPaise), totalPaise: Number(p.totalPaise) })),
      topup: { available: !!(s.razorpay.keyId && rp), gstPct: s.gstPct, minInr: s.minTopupInr },
      feePct: s.feePct,
    };
  }

  async startTopup(userId: string, amountInr: number, billing: Record<string, string>) {
    const s = await loadAds(this.q);
    const secret = await adsSecret("razorpay-key-secret");
    if (!s.razorpay.keyId || !secret) throw new ServiceUnavailableException("Adding money isn't available yet.");
    const amount = Math.round(amountInr);
    if (amount < s.minTopupInr) throw new BadRequestException(`The minimum is ${rupees(s.minTopupInr * 100)}.`);
    if (amount > 1_000_000) throw new BadRequestException("For more than ₹10 lakh at once, please contact us.");
    const amountPaise = amount * 100;
    const gstPaise = Math.round((amountPaise * s.gstPct) / 100);
    const id = randomUUID();
    const orderId = await createOrder(s.razorpay.keyId, secret, { amountPaise: amountPaise + gstPaise, receipt: id, notes: { ownerId: userId, purpose: "Topsqill ad wallet" } });
    const clean = Object.fromEntries(Object.entries(billing ?? {}).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 200)]).filter(([, v]) => v));
    await this.q(`insert into payments (id, owner_id, order_id, amount_paise, gst_paise, total_paise, billing) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, userId, orderId, amountPaise, gstPaise, amountPaise + gstPaise, JSON.stringify(clean)]);
    const [u] = await this.q("select name, email, phone from users where id = $1", [userId]);
    return { orderId, keyId: s.razorpay.keyId, amountPaise: amountPaise + gstPaise, currency: "INR", name: s.business.name || "Topsqill",
      description: `Ad wallet ${rupees(amountPaise)} + GST`, prefill: { name: clean.name ?? u?.name ?? "", email: u?.email ?? "", contact: u?.phone ?? "" } };
  }

  /** The checkout came back: accept it only if Razorpay's signature matches. */
  async confirmTopup(userId: string, orderId: string, paymentId: string, signature: string) {
    const secret = await adsSecret("razorpay-key-secret");
    if (!secret) throw new ServiceUnavailableException("Payments aren't set up.");
    if (!checkoutSignatureOk(secret, orderId, paymentId, signature)) throw new BadRequestException("We couldn't confirm that payment. If money was taken, it will be added automatically within a few minutes.");
    const [p] = await this.q("select owner_id from payments where order_id = $1", [orderId]);
    if (!p || p.owner_id !== userId) throw new NotFoundException("That payment isn't yours.");
    return this.markPaid(orderId, paymentId);
  }

  /** Razorpay's webhook (payment captured / order paid), for when the page was closed before confirming. */
  async razorpayWebhook(raw: Buffer | undefined, signature: string | undefined, body: Row) {
    const secret = await adsSecret("razorpay-webhook-secret");
    if (!secret || !raw || !webhookSignatureOk(secret, raw, signature ?? "")) throw new ForbiddenException("Bad signature.");
    const pay = body?.payload?.payment?.entity, order = body?.payload?.order?.entity;
    const orderId = pay?.order_id ?? order?.id;
    if (!orderId) return { ok: true };
    if (body.event === "payment.failed") { await this.q("update payments set status = 'failed' where order_id = $1 and status = 'created'", [orderId]); return { ok: true }; }
    if (body.event === "payment.captured" || body.event === "order.paid") await this.markPaid(orderId, pay?.id ?? null).catch((e) => this.log.warn(`webhook ${orderId}: ${e.message}`));
    return { ok: true };
  }

  /** Credits the wallet once, however many times it's called for the same order, and numbers the invoice. */
  private async markPaid(orderId: string, paymentId: string | null) {
    const res = await inTx(this.pool, async (q) => {
      const [p] = await q("select * from payments where order_id = $1 for update", [orderId]);
      if (!p) throw new NotFoundException("Unknown order.");
      if (p.status === "paid") return { already: true, p };
      const fy = (() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; })();
      const [{ n }] = await q<{ n: string }>("select nextval('invoice_seq') as n");
      const invoiceNo = `TSQ/${fy}/${String(n).padStart(6, "0")}`;
      await q("update payments set status = 'paid', payment_id = coalesce($2, payment_id), paid_at = now(), invoice_no = $3 where id = $1", [p.id, paymentId, invoiceNo]);
      await ledger.credit(q, p.owner_id, Number(p.amount_paise), `pay:${orderId}`, { paymentId: p.id, note: `Added money (invoice ${invoiceNo})` });
      return { already: false, p: { ...p, invoice_no: invoiceNo } };
    });
    if (!res.already) {
      await this.notifs.create({ userId: res.p.owner_id, kind: "campaign", title: `${rupees(Number(res.p.amount_paise))} added to your ad wallet`,
        body: `Invoice ${res.p.invoice_no}. You can use it for any campaign.`, targetType: "wallet", targetId: res.p.id }).catch(() => null);
    }
    return { ok: true, ...(await ledger.balance(this.q, res.p.owner_id)) };
  }

  /** A tax invoice for one top-up. */
  async invoice(userId: string, paymentId: string, admin = false) {
    const [p] = await this.q("select * from payments where id = $1 and status = 'paid'", [paymentId]);
    if (!p || (!admin && p.owner_id !== userId)) throw new NotFoundException("Invoice not found.");
    const s = await loadAds(this.q);
    const [u] = await this.q("select name, email, phone, city from users where id = $1", [p.owner_id]);
    const billing = p.billing ?? {};
    const buyerGstin = String(billing.gstin ?? "").toUpperCase();
    const buyerState = buyerGstin.slice(0, 2) || String(billing.stateCode ?? "");
    const sameState = !!s.business.stateCode && buyerState === s.business.stateCode;
    const gst = Number(p.gst_paise);
    return {
      invoiceNo: p.invoice_no, date: p.paid_at, paymentRef: p.payment_id,
      seller: { ...s.business },
      buyer: { name: billing.name || u?.name, gstin: buyerGstin || null, address: billing.address || null, email: u?.email, phone: u?.phone },
      lines: [{ description: "Prepaid advertising credit (Topsqill ad wallet)", sac: s.business.sac || null, amountPaise: Number(p.amount_paise) }],
      tax: sameState ? [{ name: `CGST ${s.gstPct / 2}%`, paise: Math.floor(gst / 2) }, { name: `SGST ${s.gstPct / 2}%`, paise: gst - Math.floor(gst / 2) }] : [{ name: `IGST ${s.gstPct}%`, paise: gst }],
      totalPaise: Number(p.total_paise),
    };
  }

  /* ------------------------------- campaigns -------------------------------- */

  private async campaign(userId: string, id: string) {
    const [c] = await this.q("select * from campaigns where id = $1", [id]);
    if (!c || c.owner_id !== userId) throw new NotFoundException("That campaign could not be found.");
    return c;
  }

  /** Everything the campaign page needs to run ads: platforms, costs, wallet, and the ads' current state. */
  async adsInfo(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    const ready = await readyPlatforms(this.q);
    const w = await ledger.balance(this.q, userId);
    const [l] = await this.q("select id, title, status, hidden, purpose, possession, rera_number, lat, lng, cover_media_id from listings where id = $1", [c.listing_id]);
    const photos = l ? await this.q(`select m.id, m.kind, m.variants from listing_media lm join media m on m.id = lm.media_id where lm.listing_id = $1 and m.status = 'ready' and m.kind in ('image','video') order by lm.position`, [l.id]) : [];
    const deliveries = await this.q(`select platform, status, error, stats, spend_paise as "spendPaise", budget_inr as "budgetInr", synced_at as "syncedAt" from campaign_deliveries where campaign_id = $1 order by created_at`, [id]);
    const { publicBase } = await import("../media/storage");
    const base = publicBase();
    const problems: string[] = [];
    if (!ready.settings.enabled) problems.push("Ads aren't switched on yet.");
    if (!l || l.hidden || l.status !== "active") problems.push("The listing must be live (approved) to advertise it.");
    if (l?.purpose === "sale" && l?.possession === "Under construction" && !l?.rera_number) problems.push("Add the project's RERA number to the listing: it must be shown in ads for under-construction homes.");
    return {
      status: c.status, enabled: ready.settings.enabled,
      platforms: { meta: ready.meta, google: ready.google },
      chosen: c.platforms ?? [], mediaIds: c.media_ids ?? [],
      feePct: Number(c.status === "draft" ? ready.settings.feePct : c.fee_pct), minBudgetInr: ready.settings.minCampaignInr,
      wallet: w, holdPaise: Number(c.hold_paise), chargedPaise: Number(c.charged_paise),
      reviewNote: c.review_note, submittedAt: c.submitted_at, launchedAt: c.launched_at, endsAt: c.ends_at, endReason: c.end_reason,
      results: { spendInr: Number(c.spend_inr), clicks: Number(c.clicks_count), impressions: Number(c.impressions_count), leads: Number(c.leads_count) },
      deliveries: deliveries.map((d) => ({ ...d, spendPaise: Number(d.spendPaise) })),
      photos: photos.map((m) => {
        const v = m.variants?.thumb_jpeg ?? m.variants?.card_jpeg ?? m.variants?.thumb_webp ?? null;
        return { id: m.id, kind: m.kind, thumb: v ? (v.startsWith("http") ? v : `${base}/${v}`) : null };
      }),
      hasMapPin: l?.lat != null, problems,
    };
  }

  /** The member sends the campaign for review; the budget plus fee is set aside from the wallet. */
  async submit(userId: string, id: string, input: { platforms: string[]; budgetInr: number; days: number; mediaIds: string[] }) {
    const c = await this.campaign(userId, id);
    if (c.status !== "draft" && c.status !== "rejected") throw new BadRequestException("This campaign has already been sent.");
    const info = await this.adsInfo(userId, id);
    if (info.problems.length) throw new BadRequestException(info.problems[0]);
    const platforms = [...new Set(input.platforms)].filter((p) => (p === "meta" && info.platforms.meta) || (p === "google" && info.platforms.google));
    if (!platforms.length) throw new BadRequestException("Choose where to run the ads.");
    const s = await loadAds(this.q);
    const budget = Math.round(input.budgetInr);
    if (budget < s.minCampaignInr) throw new BadRequestException(`The minimum budget is ${rupees(s.minCampaignInr * 100)}.`);
    const days = Math.min(Math.max(Math.round(input.days), 3), 90);
    if (budget / days < 300) throw new BadRequestException("That's under ₹300 a day: add budget or shorten the campaign, or the ads barely show.");
    const allowed = new Set(info.photos.map((p) => p.id));
    const mediaIds = input.mediaIds.filter((m) => allowed.has(m)).slice(0, 6);
    if (!mediaIds.some((m) => info.photos.find((p) => p.id === m)?.kind === "image")) throw new BadRequestException("Pick at least one photo for the ads.");
    const hold = Math.round(budget * 100 * (1 + s.feePct / 100));
    try {
      await inTx(this.pool, async (q) => {
        await ledger.hold(q, userId, id, hold, `hold:${id}:${Date.now()}`);
        await q(`update campaigns set status = 'review', platforms = $2, media_ids = $3, budget_inr = $4, days = $5, hold_paise = $6, charged_paise = 0,
                   fee_pct = $7, submitted_at = now(), review_note = null, reviewed_at = null, ends_at = null, end_reason = null, updated_at = now() where id = $1`,
          [id, JSON.stringify(platforms), JSON.stringify(mediaIds), budget, days, hold, s.feePct]);
      });
    } catch (e) {
      if (e instanceof InsufficientFunds) throw new BadRequestException(`You need ${rupees(hold)} in your wallet (you have ${rupees(e.havePaise)}). Add ${rupees(hold - e.havePaise)} to continue.`);
      throw e;
    }
    for (const a of await this.admins()) {
      await this.notifs.create({ userId: a.id, kind: "system", title: "Ad campaign waiting for review", body: `${String(c.name).slice(0, 80)} · ${rupees(budget * 100)} · ${platforms.join(" + ")}`, targetType: "campaign-review", targetId: id }).catch(() => null);
    }
    await this.notifs.create({ userId, kind: "campaign", title: "Campaign sent for review", body: `${rupees(hold)} is set aside from your wallet. Our team checks the ads before they go live, usually within a few hours.`, targetType: "campaign", targetId: id }).catch(() => null);
    return this.adsInfo(userId, id);
  }

  /** Taken back before review: the set-aside money returns to the wallet. */
  async withdraw(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    if (c.status !== "review") throw new BadRequestException("Only a campaign waiting for review can be taken back.");
    await inTx(this.pool, async (q) => {
      await ledger.release(q, userId, id, Number(c.hold_paise), `release:${id}:withdraw:${c.submitted_at?.valueOf?.() ?? Date.now()}`, "Campaign taken back before review");
      await q("update campaigns set status = 'draft', hold_paise = 0, updated_at = now() where id = $1", [id]);
    });
    return this.adsInfo(userId, id);
  }

  async pause(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    if (c.status !== "active") throw new BadRequestException("Only a running campaign can be paused.");
    const r = await setLive(this.pool, id, false);
    await this.q("update campaigns set status = 'paused', updated_at = now() where id = $1", [id]);
    return { ...(await this.adsInfo(userId, id)), errors: r.errors };
  }
  async resume(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    if (c.status !== "paused") throw new BadRequestException("Only a paused campaign can be resumed.");
    if (c.ends_at && new Date(c.ends_at).getTime() <= Date.now()) throw new BadRequestException("This campaign's dates are over.");
    const r = await setLive(this.pool, id, true);
    await this.q("update campaigns set status = 'active', updated_at = now() where id = $1", [id]);
    return { ...(await this.adsInfo(userId, id)), errors: r.errors };
  }
  async end(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    if (c.status !== "active" && c.status !== "paused") throw new BadRequestException("This campaign isn't running.");
    await syncCampaign(this.pool, id).catch(() => null);
    await endCampaign(this.pool, id, "Ended by you", this.notify);
    return this.adsInfo(userId, id);
  }
  async refresh(userId: string, id: string) {
    const c = await this.campaign(userId, id);
    if (["active", "paused", "completed"].includes(c.status)) await syncCampaign(this.pool, id, this.notify);
    return this.adsInfo(userId, id);
  }

  /* --------------------------------- admin ---------------------------------- */

  async adminQueue(status: string) {
    const st = ["review", "active", "paused", "completed", "rejected"].includes(status) ? status : "review";
    const rows = await this.q(`
      select c.id, c.name, c.status, c.goal, c.budget_inr as "budgetInr", c.days, c.platforms, c.media_ids as "mediaIds", c.hold_paise as "holdPaise",
             c.charged_paise as "chargedPaise", c.fee_pct as "feePct", c.submitted_at as "submittedAt", c.reviewed_at as "reviewedAt", c.review_note as "reviewNote",
             c.launched_at as "launchedAt", c.ends_at as "endsAt", c.end_reason as "endReason", c.creatives, c.leads_count as "leads", c.spend_inr as "spendInr",
             l.id as "listingId", l.title as "listingTitle", l.status as "listingStatus", l.city, l.locality, l.price_inr as "priceInr", l.rera_number as "reraNumber", l.possession,
             u.id as "ownerId", u.name as "ownerName", u.type as "ownerType", u.kyc_verified as "kycVerified", u.rera_verified as "reraVerified", u.phone, u.email
        from campaigns c left join listings l on l.id = c.listing_id join users u on u.id = c.owner_id
       where c.status = $1 order by coalesce(c.submitted_at, c.updated_at) ${st === "review" ? "asc" : "desc"} limit 100`, [st]);
    const ids = rows.map((r) => r.id);
    const [ds, counts, media] = await Promise.all([
      ids.length ? this.q(`select campaign_id as "campaignId", platform, status, error, spend_paise as "spendPaise", stats from campaign_deliveries where campaign_id = any($1) order by created_at`, [ids]) : [],
      this.q(`select status, count(*)::int as n from campaigns where status in ('review','active','paused','completed','rejected') group by status`),
      ids.length ? this.q(`select id, variants from media where id in (select jsonb_array_elements_text(media_ids) from campaigns where id = any($1))`, [ids]) : [],
    ]);
    const mediaById = new Map(media.map((m) => [m.id, m.variants?.card_jpeg ?? m.variants?.thumb_jpeg ?? null]));
    const { publicBase } = await import("../media/storage");
    const base = publicBase();
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      items: rows.map((r) => ({
        ...r, holdPaise: Number(r.holdPaise), chargedPaise: Number(r.chargedPaise), feePct: Number(r.feePct),
        photos: (r.mediaIds ?? []).map((id: string) => mediaById.get(id)).filter(Boolean).map((v: string) => (v.startsWith("http") ? v : `${base}/${v}`)),
        deliveries: ds.filter((d) => d.campaignId === r.id).map((d) => ({ ...d, spendPaise: Number(d.spendPaise) })),
      })),
    };
  }

  /** Approve (creates the ads on the platforms now) or reject (the money goes back). */
  async decide(adminId: string, id: string, decision: "approve" | "reject", note?: string) {
    const [c] = await this.q("select * from campaigns where id = $1", [id]);
    if (!c) throw new NotFoundException("Campaign not found.");
    if (c.status !== "review") throw new BadRequestException("This campaign isn't waiting for review.");
    const text = note?.trim().slice(0, 1000) || null;
    if (decision === "reject") {
      if (!text) throw new BadRequestException("Write a note so the member knows what to change.");
      await inTx(this.pool, async (q) => {
        await ledger.release(q, c.owner_id, id, Number(c.hold_paise), `release:${id}:reject:${Date.now()}`, "Campaign not approved");
        await q("update campaigns set status = 'rejected', hold_paise = 0, review_note = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now() where id = $1", [id, text, adminId]);
      });
      await this.q("insert into audit_log (id, actor_id, action, target_type, target_id, meta) values ($1,$2,'campaign.rejected','campaign',$3,$4)", [randomUUID(), adminId, id, JSON.stringify({ note: text })]).catch(() => null);
      await this.notify({ userId: c.owner_id, title: "Campaign not approved", body: `${text} · ${rupees(Number(c.hold_paise))} is back in your wallet. Edit it and send it again.`, targetType: "campaign", targetId: id });
      return { ok: true, status: "rejected" };
    }
    await this.q("update campaigns set review_note = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now() where id = $1", [id, text, adminId]);
    const results = await launchCampaign(this.pool, id);
    const live = results.filter((r) => r.status === "live");
    await this.q("insert into audit_log (id, actor_id, action, target_type, target_id, meta) values ($1,$2,'campaign.approved','campaign',$3,$4)", [randomUUID(), adminId, id, JSON.stringify({ results })]).catch(() => null);
    if (live.length) {
      const names = live.map((r) => (r.platform === "meta" ? "Facebook and Instagram" : "Google Search")).join(" and ");
      await this.notify({ userId: c.owner_id, title: "Your ads are live", body: `${String(c.name).slice(0, 80)} is now running on ${names}.${text ? ` Note: ${text}` : ""}`, targetType: "campaign", targetId: id });
    }
    return { ok: live.length > 0, status: live.length ? "active" : "review", results };
  }

  async adminSettings() {
    const s = await loadAds(this.q);
    const secrets = Object.fromEntries(await Promise.all(ADS_SECRET_NAMES.map(async (n) => [n, { set: !!(await adsSecret(n)), id: secretId(n) }])));
    return { settings: s, secrets };
  }

  async saveSettings(adminId: string, patch: Partial<AdsSettings>) {
    const cur = await loadAds(this.q);
    const next = normaliseAds({ ...cur, ...patch, meta: { ...cur.meta, ...(patch.meta ?? {}) }, google: { ...cur.google, ...(patch.google ?? {}) },
      razorpay: { ...cur.razorpay, ...(patch.razorpay ?? {}) }, business: { ...cur.business, ...(patch.business ?? {}) } });
    await this.q(`insert into app_settings (key, value, updated_by, updated_at) values ('ads', $1, $2, now())
                  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`, [JSON.stringify(next), adminId]);
    await this.q("insert into audit_log (id, actor_id, action, target_type, target_id, meta) values ($1,$2,'ads.settings','settings','ads',$3)", [randomUUID(), adminId, JSON.stringify(patch)]).catch(() => null);
    forgetAds();
    return this.adminSettings();
  }

  /** Tries each connection with the stored keys and says what works. */
  async check() {
    clearAdsSecrets(); forgetAds();
    const s = await loadAds(this.q);
    const out: Record<string, unknown> = {};
    const m = await metaCtx(s);
    out.meta = m ? await metaCheck(m).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: (e as Error).message })) : { ok: false, error: "Missing token, ad account or Page id" };
    const g = await googleCtx(s);
    out.google = g ? await googleCheck(g).then((r) => ({ ok: true, ...r })).catch((e) => ({ ok: false, error: (e as Error).message })) : { ok: false, error: "Missing developer token, OAuth or customer id" };
    const rs = await adsSecret("razorpay-key-secret");
    out.razorpay = s.razorpay.keyId && rs ? await checkKeys(s.razorpay.keyId, rs) : { ok: false, error: "Missing key id or key secret" };
    out.razorpayWebhook = { ok: !!(await adsSecret("razorpay-webhook-secret")) };
    return out;
  }

  /** Credits or debits a member's wallet by hand (refunds, goodwill), with a reason. */
  async adjust(adminId: string, ownerId: string, amountInr: number, note: string) {
    const paise = Math.round(amountInr * 100);
    if (!paise) throw new BadRequestException("Enter an amount.");
    if (!note?.trim()) throw new BadRequestException("Write the reason.");
    const ref = `adjust:${adminId}:${Date.now()}`;
    await inTx(this.pool, async (q) => {
      if (paise > 0) await ledger.credit(q, ownerId, paise, ref, { kind: "adjust", note: note.trim() });
      else await ledger.debit(q, ownerId, -paise, ref, note.trim());
    }).catch((e) => { if (e instanceof InsufficientFunds) throw new BadRequestException("The wallet doesn't have that much available."); throw e; });
    await this.q("insert into audit_log (id, actor_id, action, target_type, target_id, meta) values ($1,$2,'wallet.adjust','user',$3,$4)", [randomUUID(), adminId, ownerId, JSON.stringify({ paise, note })]).catch(() => null);
    await this.notify({ userId: ownerId, title: paise > 0 ? `${rupees(paise)} added to your ad wallet` : `${rupees(-paise)} taken from your ad wallet`, body: note.trim(), targetType: "wallet", targetId: ownerId });
    return ledger.balance(this.q, ownerId);
  }

  async adminWallets(search?: string) {
    const rows = await this.q(`select u.id, u.name, u.email, u.phone, w.balance_paise as "balancePaise", w.held_paise as "heldPaise", w.updated_at as "updatedAt"
        from wallets w join users u on u.id = w.owner_id
       where ($1::text is null or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%' or u.phone like '%' || $1 || '%')
       order by w.updated_at desc limit 50`, [search?.trim() || null]);
    const [tot] = await this.q(`select coalesce(sum(balance_paise),0) as b, coalesce(sum(held_paise),0) as h from wallets`);
    return { totals: { balancePaise: Number(tot.b), heldPaise: Number(tot.h) }, items: rows.map((r) => ({ ...r, balancePaise: Number(r.balancePaise), heldPaise: Number(r.heldPaise) })) };
  }

  async metaVerifyToken() { return (await loadAds(this.q)).meta.webhookVerifyToken || null; }

  /* --------------------------- leads from the ads --------------------------- */

  /**
   * Meta's Page webhook: someone filled in one of our lead forms. The lead is
   * fetched and added to the campaign owner's Leads, tagged with the campaign.
   */
  async metaLeadWebhook(body: Row) {
    const s = await loadAds(this.q);
    const ctx = await metaCtx(s);
    if (!ctx) return { ok: true };
    for (const entry of body?.entry ?? []) {
      for (const ch of entry?.changes ?? []) {
        const v = ch?.value;
        if (ch?.field !== "leadgen" || !v?.leadgen_id) continue;
        try {
          const lead = await metaLead(ctx, String(v.leadgen_id));
          const formId = lead.formId ?? v.form_id;
          const [d] = await this.q(`select d.campaign_id, c.owner_id, c.listing_id from campaign_deliveries d join campaigns c on c.id = d.campaign_id
                                     where d.platform = 'meta' and (d.external->>'formId' = $1 or d.external_campaign_id = $2) limit 1`, [String(formId ?? ""), String(lead.campaignId ?? "")]);
          if (!d) { this.log.warn(`lead ${lead.id}: no campaign for form ${formId}`); continue; }
          const [l] = await this.q("select city, locality from listings where id = $1", [d.listing_id]);
          const timeline = { now: "Within a month", "3m": "1 to 3 months", later: "Exploring" }[lead.timeline] ?? lead.timeline;
          const { lead: row } = await this.leads.capture(d.owner_id, {
            name: lead.name, phone: lead.phone, email: lead.email || undefined, source: "meta", sourceDetail: "Facebook / Instagram ad",
            listingId: d.listing_id, city: l?.city, locality: l?.locality, timeline: timeline || undefined, externalId: lead.id,
          });
          await this.q("update leads set campaign_id = $2 where id = $1", [row.id, d.campaign_id]);
          await this.q("update campaigns set leads_count = (select count(*) from leads where campaign_id = $1), updated_at = now() where id = $1", [d.campaign_id]);
        } catch (e) { this.log.warn(`meta lead ${v.leadgen_id}: ${(e as Error).message}`); }
      }
    }
    return { ok: true };
  }

  /** A buyer who arrived from an ad and then enquired: the lead is credited to that campaign. */
  async creditLead(leadId: string, campaignId: string) {
    const [c] = await this.q("select id from campaigns where id = $1", [campaignId]);
    if (!c) return;
    await this.q("update leads set campaign_id = $2 where id = $1 and campaign_id is null", [leadId, campaignId]);
    await this.q("update campaigns set leads_count = (select count(*) from leads where campaign_id = $1), updated_at = now() where id = $1", [campaignId]);
  }
}
