"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

type S = {
  enabled: boolean; feePct: number; gstPct: number; minTopupInr: number; minCampaignInr: number;
  meta: { adAccountId: string; pageId: string; instagramUserId: string; housingCategory: boolean; apiVersion: string; radiusKm: number; webhookVerifyToken: string };
  google: { customerId: string; loginCustomerId: string; apiVersion: string; radiusKm: number };
  razorpay: { keyId: string };
  business: { name: string; gstin: string; address: string; stateCode: string; sac: string; email: string };
};
export type AdsAdmin = { settings: S; secrets: Record<string, { set: boolean; id: string }> };
type Check = Record<string, { ok: boolean; error?: string; [k: string]: unknown }>;

const SECRET_HELP: Record<string, string> = {
  "meta-ads-token": "Meta system user token: ads_management, leads_retrieval, pages_manage_ads, pages_read_engagement, business_management",
  "google-ads-developer-token": "Google Ads API developer token (from the manager account's API Center)",
  "google-ads-oauth": 'JSON: {"client_id":"…","client_secret":"…","refresh_token":"…"}',
  "razorpay-key-secret": "Razorpay key secret (Settings → API keys)",
  "razorpay-webhook-secret": "The secret you type when adding the Razorpay webhook",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="small" style={{ display: "grid", gap: 3 }}><b>{label}</b>{children}{hint ? <span className="muted">{hint}</span> : null}</label>;
}

export function AdsSettingsForm({ initial, apiBase }: { initial: AdsAdmin; apiBase: string }) {
  const [s, setS] = useState<S>(initial.settings);
  const [secrets, setSecrets] = useState(initial.secrets);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const set = <K extends keyof S>(k: K, v: S[K]) => setS((x) => ({ ...x, [k]: v }));
  const sub = <K extends "meta" | "google" | "razorpay" | "business">(k: K, f: keyof S[K], v: unknown) => setS((x) => ({ ...x, [k]: { ...x[k], [f]: v } }));
  const num = (v: string) => Number(v) || 0;

  async function save() {
    setBusy("save"); setMsg("");
    try { const r = await clientApi<AdsAdmin>("/v1/admin/ads/settings", { method: "POST", body: s }); setS(r.settings); setSecrets(r.secrets); setMsg("✓ Saved"); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  }
  async function runCheck() {
    setBusy("check");
    try { setCheck(await clientApi<Check>("/v1/admin/ads/check", { method: "POST" })); } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  }

  const box = { border: "1.5px solid var(--line)", borderRadius: 14, padding: 14, display: "grid", gap: 10 } as const;
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 } as const;
  return (
    <section className="card pad" style={{ display: "grid", gap: 14, marginBottom: 16 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <label className="row" style={{ gap: 8, fontWeight: 800 }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Members can run ads
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-g sm" onClick={runCheck} disabled={!!busy}>{busy === "check" ? "Checking…" : "Check connections"}</button>
          <button className="btn btn-p sm" onClick={save} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save"}</button>
        </div>
      </div>
      {msg ? <p className="small" role="status" style={{ margin: 0 }}>{msg}</p> : null}
      {check ? (
        <div className="small" style={{ background: "var(--soft)", borderRadius: 10, padding: "8px 10px" }}>
          {Object.entries(check).map(([k, v]) => (
            <div key={k}><b style={{ color: v.ok ? "#12B76A" : "#E5484D" }}>{v.ok ? "✓" : "✕"} {k}</b> {v.ok ? Object.entries(v).filter(([x]) => x !== "ok").map(([x, y]) => `${x}: ${y}`).join(" · ") : v.error}</div>
          ))}
        </div>
      ) : null}

      <div style={box}>
        <b>Money</b>
        <div style={grid}>
          <Field label="Topsqill fee on ad spend (%)" hint="Added on top of what the ads spend. 0 = no fee."><input type="number" min={0} max={50} step={0.5} value={s.feePct} onChange={(e) => set("feePct", num(e.target.value))} /></Field>
          <Field label="GST on top-ups (%)"><input type="number" min={0} max={28} value={s.gstPct} onChange={(e) => set("gstPct", num(e.target.value))} /></Field>
          <Field label="Smallest top-up (₹)"><input type="number" min={100} value={s.minTopupInr} onChange={(e) => set("minTopupInr", num(e.target.value))} /></Field>
          <Field label="Smallest campaign (₹)"><input type="number" min={500} value={s.minCampaignInr} onChange={(e) => set("minCampaignInr", num(e.target.value))} /></Field>
          <Field label="Razorpay key id" hint="Starts rzp_live_ (or rzp_test_ for testing)"><input value={s.razorpay.keyId} onChange={(e) => sub("razorpay", "keyId", e.target.value.trim())} /></Field>
        </div>
      </div>

      <div style={box}>
        <b>Meta (Facebook and Instagram)</b>
        <div style={grid}>
          <Field label="Ad account id" hint="Business settings → Ad accounts"><input value={s.meta.adAccountId} onChange={(e) => sub("meta", "adAccountId", e.target.value)} placeholder="act_…" /></Field>
          <Field label="Facebook Page id" hint="Topsqill's Page: ads and lead forms run from it"><input value={s.meta.pageId} onChange={(e) => sub("meta", "pageId", e.target.value)} /></Field>
          <Field label="Instagram account id" hint="Optional: show ads as Topsqill's Instagram"><input value={s.meta.instagramUserId} onChange={(e) => sub("meta", "instagramUserId", e.target.value)} /></Field>
          <Field label="Area around the property (km)"><input type="number" min={1} max={80} value={s.meta.radiusKm} onChange={(e) => sub("meta", "radiusKm", num(e.target.value))} /></Field>
          <Field label="API version"><input value={s.meta.apiVersion} onChange={(e) => sub("meta", "apiVersion", e.target.value.trim())} /></Field>
          <Field label="Webhook verify word" hint="Any word; type the same in Meta's webhook setup"><input value={s.meta.webhookVerifyToken} onChange={(e) => sub("meta", "webhookVerifyToken", e.target.value.trim())} /></Field>
        </div>
        <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={s.meta.housingCategory} onChange={(e) => sub("meta", "housingCategory", e.target.checked)} style={{ marginTop: 3 }} />
          <span>Declare Meta&apos;s <b>Housing</b> special ad category. Meta requires it in some countries; with it, ads can&apos;t target by age and need an area of at least 25 km. Turn it on if Meta rejects ads for not declaring it.</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>Leads webhook (Meta app → Webhooks → Page → <b>leadgen</b>): <code>{apiBase}/v1/ads/meta/webhook</code></p>
      </div>

      <div style={box}>
        <b>Google Ads (Search)</b>
        <div style={grid}>
          <Field label="Customer id" hint="The account the ads run in, e.g. 123-456-7890"><input value={s.google.customerId} onChange={(e) => sub("google", "customerId", e.target.value)} /></Field>
          <Field label="Manager (MCC) id" hint="Only if you sign in through a manager account"><input value={s.google.loginCustomerId} onChange={(e) => sub("google", "loginCustomerId", e.target.value)} /></Field>
          <Field label="Area around the property (km)"><input type="number" min={1} max={80} value={s.google.radiusKm} onChange={(e) => sub("google", "radiusKm", num(e.target.value))} /></Field>
          <Field label="API version"><input value={s.google.apiVersion} onChange={(e) => sub("google", "apiVersion", e.target.value.trim())} /></Field>
        </div>
      </div>

      <div style={box}>
        <b>Invoice details (shown on members&apos; GST invoices)</b>
        <div style={grid}>
          <Field label="Business name"><input value={s.business.name} onChange={(e) => sub("business", "name", e.target.value)} /></Field>
          <Field label="GSTIN"><input value={s.business.gstin} onChange={(e) => sub("business", "gstin", e.target.value.toUpperCase())} /></Field>
          <Field label="State code" hint="First 2 digits of the GSTIN, e.g. 09 for Uttar Pradesh"><input value={s.business.stateCode} maxLength={2} onChange={(e) => sub("business", "stateCode", e.target.value)} /></Field>
          <Field label="SAC code" hint="Ask your CA which code applies"><input value={s.business.sac} onChange={(e) => sub("business", "sac", e.target.value)} /></Field>
          <Field label="Billing email"><input value={s.business.email} onChange={(e) => sub("business", "email", e.target.value)} /></Field>
        </div>
        <Field label="Registered address"><textarea rows={2} value={s.business.address} onChange={(e) => sub("business", "address", e.target.value)} /></Field>
      </div>

      <div style={box}>
        <b>Keys and tokens (Secret Manager)</b>
        <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
          {Object.entries(secrets).map(([k, v]) => (
            <li key={k}><b style={{ color: v.set ? "#12B76A" : "#E5484D" }}>{v.set ? "✓ Set" : "✕ Missing"}</b> <code>{v.id}</code> <span className="muted">· {SECRET_HELP[k]}</span></li>
          ))}
        </ul>
        <p className="small muted" style={{ margin: 0 }}>Razorpay webhook (Dashboard → Webhooks, events <b>payment.captured</b>, <b>payment.failed</b>, <b>order.paid</b>): <code>{apiBase}/v1/payments/razorpay/webhook</code></p>
      </div>
    </section>
  );
}
