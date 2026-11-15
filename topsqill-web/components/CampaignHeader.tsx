"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { CAMPAIGN_COLOR } from "@/lib/format";

const LABEL: Record<string, string> = { draft: "Draft", review: "In review", rejected: "Not approved", active: "Live", paused: "Paused", completed: "Finished", scheduled: "Scheduled" };

/**
 * The campaign's name and status, with Rename and Delete while it's still a
 * draft or was rejected (nothing is running yet, so nothing else is affected).
 */
export function CampaignHeader({ id, name: initial, status }: { id: string; name: string; status: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const canEdit = status === "draft" || status === "rejected";

  async function save() {
    const clean = draft.trim();
    if (!clean || clean === name) { setEditing(false); setDraft(name); return; }
    setBusy(true);
    try { await clientApi(`/v1/campaigns/${id}`, { method: "PATCH", body: { name: clean } }); setName(clean); setEditing(false); router.refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setBusy(true);
    try { await clientApi(`/v1/campaigns/${id}`, { method: "DELETE" }); router.push("/campaigns"); }
    catch (e) { alert((e as Error).message); setBusy(false); }
  }

  return (
    <div style={{ minWidth: 0 }}>
      {editing ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={160} style={{ fontSize: 20, fontWeight: 800, flex: "1 1 260px" }}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setDraft(name); } }} autoFocus />
          <button className="btn btn-ai sm" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
          <button className="btn btn-g sm" onClick={() => { setEditing(false); setDraft(name); }} disabled={busy}>Cancel</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <h1 style={{ fontSize: 24 }}>{name}</h1>
          {canEdit ? <button className="btn btn-g sm" onClick={() => setEditing(true)} aria-label="Rename campaign">✏️</button> : null}
          <span className="pill" style={{ background: `color-mix(in srgb,${CAMPAIGN_COLOR[status]} 16%,transparent)`, color: CAMPAIGN_COLOR[status] }}>{LABEL[status] ?? status}</span>
          {canEdit ? <button className="btn btn-g sm" onClick={remove} disabled={busy} style={{ color: "var(--red)" }}>{busy ? "…" : "🗑 Delete"}</button> : null}
        </div>
      )}
    </div>
  );
}
