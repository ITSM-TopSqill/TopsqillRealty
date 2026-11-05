"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";
import { inr, timeAgo, STAGE_LABEL } from "@/lib/format";
import type { Lead } from "@/lib/types";

const STAGES = ["new", "contacted", "site_visit", "negotiation", "booked", "lost"] as const;
const STAGE_COLOR: Record<string, string> = {
  new: "#4A86D4", contacted: "#8B4FEA", site_visit: "#E08A00",
  negotiation: "#DE8461", booked: "#12B76A", lost: "#8D8AA3",
};

/** The CRM board. Moving a lead updates the API and the screen together. */
export function LeadBoard({ columns }: { columns: Record<string, Lead[]> }) {
  const [board, setBoard] = useState(columns);
  const [open, setOpen] = useState<Lead | null>(null);

  async function move(lead: Lead, stage: string) {
    const from = lead.stage;
    if (from === stage) return;
    setBoard((b) => ({
      ...b,
      [from]: (b[from] ?? []).filter((l) => l.id !== lead.id),
      [stage]: [{ ...lead, stage }, ...(b[stage] ?? [])],
    }));
    setOpen(null);
    try {
      await clientApi(`/v1/leads/${lead.id}/stage`, { method: "POST", body: { stage } });
    } catch {
      setBoard(columns);                     // put it back if the API refused
    }
  }

  return (
    <>
      <div className="kan">
        {STAGES.map((stage) => {
          const items = board[stage] ?? [];
          return (
            <div key={stage} className="kcol">
              <h4 className="row small" style={{ margin: "4px 6px 10px", fontWeight: 800 }}>
                <i style={{ width: 10, height: 10, borderRadius: "50%", background: STAGE_COLOR[stage] }} />
                {STAGE_LABEL[stage]}
                <span className="muted" style={{ marginLeft: "auto" }}>{items.length}</span>
              </h4>
              {items.map((lead) => (
                <button key={lead.id} className="lead" onClick={() => setOpen(lead)}>
                  <b style={{ fontSize: 14 }}>{lead.name}</b>
                  {lead.listingTitle ? <div className="small muted">{lead.listingTitle}</div> : null}
                  <div className="small muted">
                    {lead.budgetMax ? `Budget ${inr(lead.budgetMax)} · ` : ""}{timeAgo(lead.createdAt)}
                  </div>
                  <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                    <span className="tag">{lead.source.replace("portal_", "")}</span>
                    <span className="small" style={{ marginLeft: "auto", fontWeight: 800, color: lead.score >= 75 ? "#E5484D" : lead.score >= 50 ? "#E08A00" : "#4A86D4" }}>
                      {lead.qualified ? "Qualified · " : ""}{lead.score}
                    </span>
                  </div>
                </button>
              ))}
              {!items.length ? <p className="small muted" style={{ padding: "0 6px" }}>Nothing here yet.</p> : null}
            </div>
          );
        })}
      </div>

      {open ? <LeadDrawer lead={open} onClose={() => setOpen(null)} onMove={move} /> : null}
    </>
  );
}

function LeadDrawer({ lead, onClose, onMove }: { lead: Lead; onClose: () => void; onMove: (l: Lead, s: string) => void }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function writeFollowUp(channel: "whatsapp" | "email" | "call") {
    setBusy(true);
    try {
      const res = await clientApi<{ text: string }>("/v1/ai/write/follow-up", {
        method: "POST",
        body: { channel, lead: { name: lead.name, listingTitle: lead.listingTitle, budgetMax: lead.budgetMax, note: lead.note } },
      });
      setDraft(res.text);
    } catch (e) { setDraft((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(14,11,34,.5)" }} />
      <div className="card" style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "min(460px,100%)", borderRadius: "18px 0 0 18px", overflow: "auto" }}>
        <div className="pad spread" style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--card)" }}>
          <h2 style={{ fontSize: 20 }}>{lead.name}</h2>
          <button className="btn btn-g sm" onClick={onClose}>Close</button>
        </div>
        <div className="pad col">
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="tag">{lead.source.replace("portal_", "")}</span>
            <span className="tag">Score {lead.score}</span>
            {lead.qualified ? <span className="tag" style={{ color: "#12B76A" }}>Qualified</span> : null}
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 14, margin: 0 }}>
            {lead.phone ? <><dt className="muted">Phone</dt><dd style={{ margin: 0, fontWeight: 700 }}><a href={`tel:${lead.phone}`}>{lead.phone}</a></dd></> : null}
            {lead.email ? <><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{lead.email}</dd></> : null}
            {lead.listingTitle ? <><dt className="muted">Interested in</dt><dd style={{ margin: 0 }}>{lead.listingTitle}</dd></> : null}
            {lead.budgetMax ? <><dt className="muted">Budget</dt><dd style={{ margin: 0 }}>{inr(lead.budgetMax)}</dd></> : null}
            {lead.note ? <><dt className="muted">Note</dt><dd style={{ margin: 0 }}>{lead.note}</dd></> : null}
          </dl>

          <div>
            <h4 className="small" style={{ margin: "4px 0 8px" }}>Move to</h4>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {STAGES.map((s) => (
                <button key={s} className={`chip ${lead.stage === s ? "on" : ""}`} onClick={() => onMove(lead, s)}>
                  {STAGE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="card pad" style={{ background: "var(--soft)" }}>
            <h4 style={{ fontSize: 15, marginBottom: 6 }}>✨ Write the follow-up</h4>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className="chip" onClick={() => writeFollowUp("whatsapp")} disabled={busy}>WhatsApp</button>
              <button className="chip" onClick={() => writeFollowUp("email")} disabled={busy}>Email</button>
              <button className="chip" onClick={() => writeFollowUp("call")} disabled={busy}>Call script</button>
            </div>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7}
              placeholder={busy ? "Writing…" : "Your draft appears here"}
              style={{ width: "100%", marginTop: 10, border: "1.5px solid var(--line)", borderRadius: 12, padding: 10, background: "var(--card)" }} />
            {lead.phone && draft ? (
              <a className="btn btn-p sm" style={{ marginTop: 8 }} target="_blank" rel="noopener"
                href={`https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(draft)}`}>
                Send on WhatsApp
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
