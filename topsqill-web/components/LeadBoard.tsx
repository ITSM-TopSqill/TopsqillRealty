"use client";

import { useEffect, useState } from "react";
import { clientApi } from "@/lib/api";
import { inr, timeAgo, STAGE_LABEL } from "@/lib/format";
import type { Lead } from "@/lib/types";

const STAGES = ["new", "contacted", "site_visit", "negotiation", "booked", "lost"] as const;
const STAGE_COLOR: Record<string, string> = {
  new: "#4A86D4", contacted: "#8B4FEA", site_visit: "#E08A00",
  negotiation: "#DE8461", booked: "#12B76A", lost: "#8D8AA3",
};

/** A reminder is still live exactly while nothing has happened on the lead since it fired. */
function isStale(lead: Lead) {
  return !!lead.followupDraft && !!lead.followupRemindedAt
    && (!lead.lastActivityAt || new Date(lead.followupRemindedAt) >= new Date(lead.lastActivityAt));
}

/** The CRM board. Moving a lead updates the API and the screen together. */
export function LeadBoard({ columns, openLeadId }: { columns: Record<string, Lead[]>; openLeadId?: string }) {
  const [board, setBoard] = useState(columns);
  const [open, setOpen] = useState<Lead | null>(() =>
    (openLeadId && Object.values(columns).flat().find((l) => l.id === openLeadId)) || null);

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
                  {isStale(lead) ? <span className="small" style={{ color: "#E08A00", fontWeight: 700, display: "block" }}>⏰ Follow-up ready</span> : null}
                  {lead.listingTitle ? <div className="small muted">{lead.listingTitle}</div> : null}
                  <div className="small muted">
                    {lead.budgetMax ? `Budget ${inr(lead.budgetMax)} · ` : ""}{timeAgo(lead.createdAt)}
                  </div>
                  <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                    <span className="tag">{lead.source === "channel_partner" ? "channel partner" : lead.source.replace("portal_", "")}</span>
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

function LeadDrawer({ lead: initialLead, onClose, onMove }: { lead: Lead; onClose: () => void; onMove: (l: Lead, s: string) => void }) {
  const [lead, setLead] = useState(initialLead);
  const stale = isStale(lead);
  const [draft, setDraft] = useState(() => (stale ? lead.followupDraft ?? "" : ""));
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState<"whatsapp" | "email" | "call" | null>(stale ? "whatsapp" : null);
  const [note, setNote] = useState("");
  const [addingEmail, setAddingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [waAccount, setWaAccount] = useState<{ phoneNumberId: string; displayNumber: string | null } | null | undefined>(undefined);
  const [sending, setSending] = useState(false);
  type WaMsg = { id: string; direction: string; body: string | null; template: string | null; status: string; createdAt: string };
  const [history, setHistory] = useState<WaMsg[] | null>(null);

  useEffect(() => { clientApi<typeof waAccount>("/v1/whatsapp/account").then(setWaAccount).catch(() => setWaAccount(null)); }, []);
  useEffect(() => {
    if (!waAccount) return;
    clientApi<{ items: WaMsg[] }>(`/v1/whatsapp/history/${lead.id}`).then((r) => setHistory(r.items)).catch(() => setHistory([]));
  }, [waAccount, lead.id]);

  function flash(t: string) { setNote(t); setTimeout(() => setNote(""), 2500); }

  async function saveEmail() {
    const email = emailInput.trim();
    if (!email) return;
    setSavingEmail(true);
    try {
      await clientApi(`/v1/leads/${lead.id}/contact`, { method: "POST", body: { email } });
      setLead((l) => ({ ...l, email }));
      setAddingEmail(false);
      setEmailInput("");
      flash("Email added");
    } catch (e) { flash((e as Error).message); }
    finally { setSavingEmail(false); }
  }

  /** Sends through the dealer's own connected WhatsApp Business number - tracked, not a hand-off to the phone's app. */
  async function sendViaWhatsApp() {
    if (!lead.phone || !draft.trim()) return;
    setSending(true);
    try {
      await clientApi("/v1/whatsapp/send", { method: "POST", body: { to: lead.phone, body: draft, leadId: lead.id } });
      flash("Sent and logged on this lead");
      clientApi<{ items: WaMsg[] }>(`/v1/whatsapp/history/${lead.id}`).then((r) => setHistory(r.items)).catch(() => {});
    } catch (e) { flash((e as Error).message); }
    finally { setSending(false); }
  }

  /** Records the follow-up on the lead's timeline, so the team sees it was done. */
  async function logIt() {
    if (!draft.trim() || !channel) return;
    try {
      await clientApi(`/v1/leads/${lead.id}/activity`, { method: "POST", body: { kind: channel, body: draft.slice(0, 2000) } });
      flash("Logged on this lead");
    } catch (e) { flash((e as Error).message); }
  }

  const subject = draft.match(/^Subject:\s*(.+)\n+/i);
  const mailto = lead.email && draft
    ? `mailto:${lead.email}?subject=${encodeURIComponent(subject?.[1] ?? "Following up")}&body=${encodeURIComponent(subject ? draft.slice(subject[0].length) : draft)}`
    : null;

  async function writeFollowUp(channel: "whatsapp" | "email" | "call") {
    setChannel(channel);
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
          {stale ? (
            <div className="card pad" style={{ background: "color-mix(in srgb, #E08A00 10%, transparent)", border: "1px solid #E08A00" }}>
              <b className="small" style={{ color: "#B26B00" }}>⏰ This lead has gone quiet</b>
              <p className="small" style={{ margin: "4px 0 0" }}>No activity in a while, so we drafted a nudge below — review it and send, or edit it first.</p>
            </div>
          ) : null}
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="tag">{lead.source === "channel_partner" ? "channel partner" : lead.source.replace("portal_", "")}</span>
            <span className="tag">Score {lead.score}</span>
            {lead.qualified ? <span className="tag" style={{ color: "#12B76A" }}>Qualified</span> : null}
          </div>

          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 14px", fontSize: 14, margin: 0 }}>
            {lead.phone ? <><dt className="muted">Phone</dt><dd style={{ margin: 0, fontWeight: 700 }}><a href={`tel:${lead.phone}`}>{lead.phone}</a></dd></> : null}
            {lead.email ? (
              <><dt className="muted">Email</dt><dd style={{ margin: 0 }}>{lead.email}</dd></>
            ) : (
              <>
                <dt className="muted">Email</dt>
                <dd style={{ margin: 0 }}>
                  {addingEmail ? (
                    <span className="row" style={{ gap: 6 }}>
                      <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="name@example.com" autoFocus
                        style={{ border: "1.5px solid var(--line)", borderRadius: 8, padding: "3px 8px", fontSize: 13, width: 170 }} />
                      <button className="btn btn-p sm" onClick={saveEmail} disabled={savingEmail || !emailInput.trim()}>Save</button>
                      <button className="btn btn-g sm" onClick={() => { setAddingEmail(false); setEmailInput(""); }}>Cancel</button>
                    </span>
                  ) : (
                    <button className="small" style={{ color: "var(--vio)", fontWeight: 700, background: "none", border: 0, padding: 0, cursor: "pointer" }}
                      onClick={() => setAddingEmail(true)}>+ Add email</button>
                  )}
                </dd>
              </>
            )}
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
            {draft && !busy ? (
              <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {channel === "whatsapp" && lead.phone && waAccount ? (
                  <button type="button" className="btn btn-p sm" onClick={sendViaWhatsApp} disabled={sending}>
                    {sending ? "Sending…" : `Send via ${waAccount.displayNumber ?? "WhatsApp Business"}`}
                  </button>
                ) : null}
                {channel === "whatsapp" && lead.phone ? (
                  <a className="btn btn-o sm" target="_blank" rel="noopener" onClick={logIt}
                    href={`https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(draft)}`}>
                    {waAccount ? "Or open in your own WhatsApp" : "Send on WhatsApp"}
                  </a>
                ) : null}
                {channel === "email" && mailto ? <a className="btn btn-p sm" href={mailto} onClick={logIt}>Open in email</a> : null}
                {channel === "call" && lead.phone ? <a className="btn btn-p sm" href={`tel:${lead.phone}`} onClick={logIt}>Call {lead.phone}</a> : null}
                <button className="btn btn-o sm" onClick={() => { navigator.clipboard?.writeText(draft).then(() => flash("Copied"), () => flash("Couldn’t copy")); }}>Copy</button>
                <button className="btn btn-g sm" onClick={logIt}>Log as done</button>
                {note ? <span className="small" style={{ color: "var(--vio)", fontWeight: 700 }} aria-live="polite">{note}</span> : null}
              </div>
            ) : null}
          </div>

          {waAccount ? (
            <div className="card pad">
              <h4 style={{ fontSize: 15, marginBottom: 8 }}>💬 WhatsApp history</h4>
              {!history?.length ? (
                <p className="small muted" style={{ margin: 0 }}>No messages with this lead yet.</p>
              ) : (
                <div className="col" style={{ gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {[...history].reverse().map((m) => (
                    <div key={m.id} style={{ alignSelf: m.direction === "out" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                      <div className="small" style={{ background: m.direction === "out" ? "var(--brand)" : "var(--soft)", color: m.direction === "out" ? "#fff" : undefined, borderRadius: 12, padding: "6px 10px" }}>
                        {m.body ?? (m.template ? `Template: ${m.template}` : "(attachment)")}
                      </div>
                      <div className="small muted" style={{ textAlign: m.direction === "out" ? "right" : "left", marginTop: 2 }}>
                        {timeAgo(m.createdAt)}{m.direction === "out" ? ` · ${m.status}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
