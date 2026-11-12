"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

type Settings = { enabled: boolean; disabled: string[]; model: string | null };
type Props = { settings: Settings; features: Record<string, string>; models: string[]; defaultModel: string; configured: boolean };

/** AI on/off for the whole platform or feature by feature, and the model. Changes apply within 30 seconds; nothing is deployed. */
export function AiSettingsForm({ settings, features, models, defaultModel, configured }: Props) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(settings);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const toggle = (f: string) => setS((x) => ({ ...x, disabled: x.disabled.includes(f) ? x.disabled.filter((d) => d !== f) : [...x.disabled, f] }));

  async function save() {
    setBusy(true); setNote("");
    try {
      await clientApi("/v1/admin/ai/settings", { method: "POST", body: s });
      setNote("Saved. Takes effect within 30 seconds.");
      router.refresh();
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <section className="card pad" style={{ marginBottom: 16 }}>
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 18 }}>⚙️ AI settings</h2>
        <button type="button" className="btn btn-p sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      </div>
      {!configured ? <p className="small error" style={{ margin: "6px 0" }}>No AI key is set, so every feature uses built-in rules whatever is chosen here.</p> : null}
      <label className="row" style={{ gap: 8, marginTop: 10, fontWeight: 700 }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS((x) => ({ ...x, enabled: e.target.checked }))} />
        AI on for the whole platform
      </label>
      <p className="small muted" style={{ margin: "2px 0 10px 26px" }}>Off: every feature keeps working with built-in rules, and no AI is paid for.</p>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="ai-model">Model</label>
        <select id="ai-model" value={s.model ?? ""} onChange={(e) => setS((x) => ({ ...x, model: e.target.value || null }))}>
          <option value="">Default ({defaultModel})</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <b className="small" style={{ display: "block", marginTop: 14 }}>Features</b>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 6, marginTop: 6, opacity: s.enabled ? 1 : 0.5 }}>
        {Object.entries(features).map(([id, name]) => (
          <label key={id} className="row small" style={{ gap: 8 }}>
            <input type="checkbox" disabled={!s.enabled} checked={!s.disabled.includes(id)} onChange={() => toggle(id)} />
            {name}
          </label>
        ))}
      </div>
      {note ? <p className="small" style={{ margin: "10px 0 0", color: "var(--vio)", fontWeight: 700 }} role="status">{note}</p> : null}
    </section>
  );
}
