"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";

export type AlertRow = { kind: string; label: string; hint: string; email: boolean; push: boolean };
export type AlertSettingsData = { items: AlertRow[]; email: string | null; pushDevices: number };

/**
 * One row per kind of alert, with a switch for email and one for the phone
 * app. Each switch saves the moment it's flipped. In-app alerts always show.
 */
export function AlertSettings({ initial }: { initial: AlertSettingsData }) {
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function save(patch: { email?: Record<string, boolean>; push?: Record<string, boolean> }, key: string) {
    const before = data;
    // Show the change at once; put it back if saving fails.
    setData((d) => ({ ...d, items: d.items.map((r) => ({ ...r, email: patch.email?.[r.kind] ?? r.email, push: patch.push?.[r.kind] ?? r.push })) }));
    setSaving(key);
    try {
      const next = await clientApi<AlertSettingsData>("/v1/me/alert-settings", { method: "POST", body: patch });
      setData(next); setNote("Saved"); setTimeout(() => setNote(""), 1800);
    } catch (e) { setData(before); setNote((e as Error).message); }
    finally { setSaving(null); }
  }

  const all = (ch: "email" | "push", on: boolean) => save({ [ch]: Object.fromEntries(data.items.map((r) => [r.kind, on])) }, `all-${ch}`);
  const allEmail = data.items.every((r) => r.email), allPush = data.items.every((r) => r.push);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card pad row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 240px" }}>
          <b>✉️&nbsp;Email</b>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {data.email ? <>Sent to <b>{data.email}</b>.</> : <>Add and verify an email address in <a href="/profile/edit">Edit profile</a> to get alerts by email.</>}
          </p>
        </div>
        <div style={{ flex: "1 1 240px" }}>
          <b>📱&nbsp;Phone app</b>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {data.pushDevices ? `On ${data.pushDevices} phone${data.pushDevices === 1 ? "" : "s"} signed in to the Topsqill.ai app.` : "Sign in to the Topsqill.ai app on your phone to get notifications there."}
          </p>
        </div>
      </div>

      <div className="card al-table" role="table" aria-label="Alert settings">
        <div className="al-row al-head" role="row">
          <span role="columnheader">Alert</span>
          <span role="columnheader" className="al-c">Email
            <button className="btn btn-g sm al-all" onClick={() => all("email", !allEmail)} disabled={!!saving}>{allEmail ? "All off" : "All on"}</button>
          </span>
          <span role="columnheader" className="al-c">Phone
            <button className="btn btn-g sm al-all" onClick={() => all("push", !allPush)} disabled={!!saving}>{allPush ? "All off" : "All on"}</button>
          </span>
        </div>
        {data.items.map((r) => (
          <div className="al-row" role="row" key={r.kind}>
            <span role="cell" className="al-name"><b>{r.label}</b><small className="muted">{r.hint}</small></span>
            <span role="cell" className="al-c">
              <Switch on={r.email} label={`${r.label} by email`} disabled={saving === `${r.kind}-email`} onChange={(v) => save({ email: { [r.kind]: v } }, `${r.kind}-email`)} />
            </span>
            <span role="cell" className="al-c">
              <Switch on={r.push} label={`${r.label} on your phone`} disabled={saving === `${r.kind}-push`} onChange={(v) => save({ push: { [r.kind]: v } }, `${r.kind}-push`)} />
            </span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Alerts always appear under 🔔 on Topsqill.ai. Emails about your account&apos;s security, sign-in codes and payments are always sent.
        <span role="status" aria-live="polite" style={{ marginLeft: 8, fontWeight: 700, color: note === "Saved" ? "var(--grn)" : "var(--red)" }}>{note}</span>
      </p>
      <style>{`
        .al-table{padding:0;overflow:hidden}
        .al-row{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;align-items:center;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
        .al-head{border-top:0;background:var(--soft);font-weight:800;font-size:13px}
        .al-name{display:flex;flex-direction:column;min-width:0}
        .al-name small{font-size:12.5px}
        .al-c{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
        .al-all{font-size:11.5px;padding:2px 8px;min-height:0}
        .sw{width:44px;height:26px;border-radius:999px;background:var(--chip);border:1px solid var(--line);position:relative;cursor:pointer;transition:background .15s}
        .sw::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .15s}
        .sw[aria-checked="true"]{background:var(--vio);border-color:var(--vio)}
        .sw[aria-checked="true"]::after{transform:translateX(18px)}
        .sw:focus-visible{outline:2px solid var(--vio);outline-offset:2px}
        .sw:disabled{opacity:.6}
        @media (max-width:560px){.al-row{grid-template-columns:minmax(0,1fr) 64px 64px;padding:12px}.al-all{display:none}}
      `}</style>
    </div>
  );
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="sw" disabled={disabled} onClick={() => onChange(!on)} />;
}
