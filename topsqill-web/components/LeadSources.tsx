"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export type Source = {
  id: string; source: string; name: string; enabled: boolean; assignRule: string;
  leadCount: number; lastEventAt?: string | null; webhookUrl: string;
};

/** What each platform is called and where its webhook setting lives. */
const PLATFORMS: { id: string; label: string; icon: string; color: string; how: string }[] = [
  { id: "meta", label: "Facebook and Instagram lead ads", icon: "f", color: "#1877F2", how: "Meta Business Suite → Integrations → Leads access → CRM webhook. Paste the link, and use its last part (after the final /) as the verify token." },
  { id: "google", label: "Google Ads lead forms", icon: "G", color: "#EA4335", how: "Google Ads → Assets → Lead form → Lead delivery → Webhook. Paste the link; any key works." },
  { id: "linkedin", label: "LinkedIn lead gen forms", icon: "in", color: "#0A66C2", how: "Use Zapier or Make: “New LinkedIn lead” → “Webhook POST” to this link." },
  { id: "website", label: "Your website form", icon: "🌐", color: "#6A3FE0", how: "POST the form as JSON with name, phone, email and message to this link." },
  { id: "portal_99acres", label: "99acres", icon: "99", color: "#0B5CAB", how: "Ask your 99acres account manager to push leads to this URL, or forward lead emails through Zapier." },
  { id: "portal_magicbricks", label: "MagicBricks", icon: "MB", color: "#D8232A", how: "Ask your MagicBricks account manager to push leads to this URL." },
  { id: "portal_housing", label: "Housing.com", icon: "H", color: "#5E23DC", how: "Ask your Housing.com account manager to push leads to this URL." },
  { id: "call", label: "Call tracking (IVR)", icon: "☎", color: "#12B76A", how: "In your IVR (Exotel, Knowlarity, MyOperator) add a missed or answered call webhook to this link." },
  { id: "other", label: "Anything else", icon: "⚡", color: "#E08A00", how: "Any tool that can send a webhook with a name and phone number." },
];
const RULES: Record<string, string> = {
  owner: "Every lead comes to me",
  round_robin: "Share in turn across my team",
  locality: "By the locality they asked about",
};

export function LeadSources({ initial, apiBase }: { initial: Source[]; apiBase: string }) {
  const [items, setItems] = useState(initial);
  const [platform, setPlatform] = useState("meta");
  const [name, setName] = useState("");
  const [rule, setRule] = useState("owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const full = (path: string) => `${apiBase.replace(/\/$/, "")}${path}`;
  const meta = (id: string) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[PLATFORMS.length - 1];

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const row = await clientApi<Source>("/v1/lead-sources", {
        method: "POST", body: { source: platform, name: name.trim() || meta(platform).label, assignRule: rule },
      });
      setItems((xs) => [{ ...row, leadCount: 0 }, ...xs]);
      setName("");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function copy(text: string, id: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(""), 1600); } catch { /* the link is visible to copy by hand */ }
  }

  return (
    <div className="col">
      <form className="card pad" onSubmit={add}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>Connect a source</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8, marginBottom: 14 }}>
          {PLATFORMS.map((p) => (
            <button type="button" key={p.id} onClick={() => setPlatform(p.id)} className="row"
              aria-pressed={platform === p.id}
              style={{ gap: 8, padding: 10, borderRadius: 12, textAlign: "left", fontWeight: 700, fontSize: 13,
                border: `2px solid ${platform === p.id ? p.color : "var(--line)"}`, background: "var(--card)" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: p.color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12, flex: "none" }}>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div className="field"><label htmlFor="sname">Name</label>
            <input id="sname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={meta(platform).label} />
          </div>
          <div className="field"><label htmlFor="rule">Who gets each lead</label>
            <select id="rule" value={rule} onChange={(e) => setRule(e.target.value)}>
              {Object.entries(RULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        {error ? <p className="error" style={{ marginTop: 10 }}>{error}</p> : null}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-ai" disabled={busy}>{busy ? "Connecting…" : "Get my link"}</button>
        </div>
      </form>

      <h2 style={{ fontSize: 18, marginTop: 6 }}>Connected ({items.length})</h2>
      {items.length ? items.map((s) => {
        const p = meta(s.source);
        const url = full(s.webhookUrl);
        return (
          <div key={s.id} className="card pad">
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <span style={{ width: 40, height: 40, borderRadius: 12, background: p.color, color: "#fff", display: "grid", placeItems: "center", fontWeight: 800, flex: "none" }}>{p.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="spread">
                  <b>{s.name}</b>
                  <span className="pill" style={{ background: s.enabled ? "color-mix(in srgb,#12B76A 15%,transparent)" : "var(--chip)", color: s.enabled ? "#0E8F57" : "var(--ink2)" }}>
                    {s.enabled ? "Active" : "Paused"}
                  </span>
                </div>
                <div className="small muted">
                  {s.leadCount} lead{s.leadCount === 1 ? "" : "s"} · {s.lastEventAt ? `last one ${timeAgo(s.lastEventAt)}` : "waiting for the first lead"} · {RULES[s.assignRule] ?? s.assignRule}
                </div>
                <div className="row" style={{ gap: 6, marginTop: 10 }}>
                  <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", fontSize: 12.5 }}>{url}</code>
                  <button className="btn btn-o sm" onClick={() => copy(url, s.id)}>{copied === s.id ? "Copied" : "Copy"}</button>
                </div>
                <p className="small muted" style={{ margin: "8px 0 0" }}>{p.how}</p>
              </div>
            </div>
          </div>
        );
      }) : (
        <div className="card pad muted small">No sources yet. Pick a platform above to get your first link.</div>
      )}
    </div>
  );
}
