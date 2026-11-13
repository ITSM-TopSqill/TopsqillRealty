import type { Q } from "./db";

/**
 * Admin-editable settings for managed ads, wallets and invoices (Admin → Ads).
 * Nothing secret lives here: tokens and keys are in Secret Manager.
 */
export type AdsSettings = {
  enabled: boolean;
  feePct: number;            // Topsqill's fee on top of ad spend, in percent
  gstPct: number;            // GST charged on wallet top-ups
  minTopupInr: number;
  minCampaignInr: number;
  meta: { adAccountId: string; pageId: string; instagramUserId: string; housingCategory: boolean; apiVersion: string; radiusKm: number; webhookVerifyToken: string };
  google: { customerId: string; loginCustomerId: string; apiVersion: string; radiusKm: number };
  razorpay: { keyId: string };
  business: { name: string; gstin: string; address: string; stateCode: string; sac: string; email: string };
};

export const DEFAULT_ADS: AdsSettings = {
  enabled: false, feePct: 0, gstPct: 18, minTopupInr: 2000, minCampaignInr: 5000,
  meta: { adAccountId: "", pageId: "", instagramUserId: "", housingCategory: false, apiVersion: "v25.0", radiusKm: 10, webhookVerifyToken: "" },
  google: { customerId: "", loginCustomerId: "", apiVersion: "v24", radiusKm: 10 },
  razorpay: { keyId: "" },
  business: { name: "Topsqill", gstin: "", address: "", stateCode: "", sac: "", email: "" },
};

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** Merges what's stored over the defaults, and tidies ids (Meta "act_123" → "123", Google "123-456-7890" → "1234567890"). */
export function normaliseAds(v: Partial<AdsSettings> | null | undefined): AdsSettings {
  const s = { ...DEFAULT_ADS, ...(v ?? {}) } as AdsSettings;
  s.meta = { ...DEFAULT_ADS.meta, ...(v?.meta ?? {}) };
  s.google = { ...DEFAULT_ADS.google, ...(v?.google ?? {}) };
  s.razorpay = { ...DEFAULT_ADS.razorpay, ...(v?.razorpay ?? {}) };
  s.business = { ...DEFAULT_ADS.business, ...(v?.business ?? {}) };
  s.meta.adAccountId = digits(s.meta.adAccountId);
  s.meta.pageId = digits(s.meta.pageId);
  s.meta.instagramUserId = digits(s.meta.instagramUserId);
  s.google.customerId = digits(s.google.customerId);
  s.google.loginCustomerId = digits(s.google.loginCustomerId);
  s.feePct = Math.min(Math.max(Number(s.feePct) || 0, 0), 50);
  s.gstPct = Math.min(Math.max(Number(s.gstPct) || 0, 0), 28);
  s.minTopupInr = Math.max(Number(s.minTopupInr) || 0, 100);
  s.minCampaignInr = Math.max(Number(s.minCampaignInr) || 0, 500);
  s.meta.radiusKm = Math.min(Math.max(Number(s.meta.radiusKm) || 10, 1), 80);
  s.google.radiusKm = Math.min(Math.max(Number(s.google.radiusKm) || 10, 1), 80);
  return s;
}

let cached: { s: AdsSettings; at: number } | null = null;
export async function loadAds(q: Q): Promise<AdsSettings> {
  if (cached && Date.now() - cached.at < 30_000) return cached.s;
  const [row] = await q<{ value: Partial<AdsSettings> }>("select value from app_settings where key = 'ads'");
  const s = normaliseAds(row?.value);
  cached = { s, at: Date.now() };
  return s;
}
export function forgetAds() { cached = null; }
