"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

export type ReportTarget = "post" | "comment" | "listing" | "profile";

/** Reasons offered for each kind of thing, most common first. */
const REASONS: Record<ReportTarget, string[]> = {
  listing: ["Fake or misleading listing", "Wrong price or details", "Property not available", "Duplicate listing", "Scam or fraud", "Offensive photos or text", "Something else"],
  post: ["Spam", "Scam or fraud", "Misleading information", "Harassment or hate", "Offensive or adult content", "Something else"],
  comment: ["Spam", "Harassment or hate", "Scam or fraud", "Offensive content", "Something else"],
  profile: ["Fake profile or impersonation", "Scam or fraud", "Harassment", "Spam or unwanted messages", "Posing as a verified dealer or builder", "Something else"],
};
const HINT: Record<ReportTarget, string> = {
  listing: "For example, the listing says ready to move but it's still under construction.",
  post: "For example, it asks people to pay a booking amount to a personal account.",
  comment: "For example, it insults another member.",
  profile: "For example, they keep messaging me after I said no.",
};
const NOUN: Record<ReportTarget, string> = { listing: "listing", post: "post", comment: "comment", profile: "profile" };

/**
 * Asks why something is being reported and sends it to the admin queue.
 * The reporter stays anonymous to the person reported.
 */
export function ReportDialog({ type, id, name, onClose }: { type: ReportTarget; id: string; name?: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [state, setState] = useState<"form" | "busy" | "done">("form");
  const [error, setError] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    box.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) { setError("Choose a reason."); return; }
    if (reason === "Something else" && detail.trim().length < 5) { setError("Tell us a little about what's wrong."); return; }
    setState("busy"); setError("");
    try {
      await clientApi("/v1/reports", { method: "POST", body: { targetType: type, targetId: id, reason, detail: detail.trim() || undefined } });
      setState("done");
    } catch (err) { setError((err as Error).message); setState("form"); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="report-title" className="sf-dialog">
      <div className="sf-scrim" onClick={onClose} />
      <div className="card sf-panel" ref={box}>
        {state === "done" ? (
          <div className="pad col" style={{ gap: 12, textAlign: "center" }}>
            <div style={{ fontSize: 40 }} aria-hidden>✅</div>
            <h2 id="report-title" style={{ fontSize: 20 }}>Thanks for telling us</h2>
            <p className="muted small" style={{ margin: 0 }}>Our team will review this {NOUN[type]}. {name ? `${name} won't know who reported it.` : "Nobody will know who reported it."}</p>
            {type !== "profile" ? null : <p className="small" style={{ margin: 0 }}>Don&apos;t want to hear from them? Choose ⛔ Block from the same ⋯ menu.</p>}
            <button className="btn btn-ai" onClick={onClose} style={{ alignSelf: "center" }}>Done</button>
          </div>
        ) : (
          <form onSubmit={send} className="col" style={{ gap: 0 }}>
            <div className="pad spread" style={{ borderBottom: "1px solid var(--line)" }}>
              <h2 id="report-title" style={{ fontSize: 19 }}>Report this {NOUN[type]}</h2>
              <button type="button" className="btn btn-g sm" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <fieldset className="pad col" style={{ gap: 6, border: 0, margin: 0 }}>
              <legend className="small muted" style={{ marginBottom: 8, padding: 0 }}>What's wrong with {name ? <b>{name}</b> : `this ${NOUN[type]}`}?</legend>
              {REASONS[type].map((r) => (
                <label key={r} className={`sf-reason ${reason === r ? "on" : ""}`}>
                  <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                  <span>{r}</span>
                </label>
              ))}
              <label className="small" style={{ fontWeight: 700, marginTop: 8 }} htmlFor="report-detail">Anything else we should know? {reason === "Something else" ? "" : <span className="muted">(optional)</span>}</label>
              <textarea id="report-detail" className="sf-text" rows={3} maxLength={1000} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={HINT[type]} />
              {error ? <p role="alert" className="small" style={{ color: "var(--red)", margin: 0 }}>{error}</p> : null}
            </fieldset>
            <div className="pad row" style={{ justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--line)" }}>
              <button type="button" className="btn btn-g" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-ai" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Send report"}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** A "Report" button (or menu item) that opens the dialog. */
export function ReportButton({ type, id, name, label, className = "btn btn-g sm", onOpen }: { type: ReportTarget; id: string; name?: string; label?: string; className?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => { onOpen?.(); setOpen(true); }}>{label ?? "⚑ Report"}</button>
      {open ? <ReportDialog type={type} id={id} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Blocks or unblocks a member, after saying plainly what that does. */
export async function setBlocked(peerId: string, name: string, block: boolean) {
  const first = name.split(" ")[0];
  const ok = confirm(block
    ? `Block ${name}?\n\n• You won't see each other's posts.\n• Neither of you can message or invite the other.\n• Any connection between you is removed.\n\n${first} won't be told. You can unblock them in Settings.`
    : `Unblock ${name}? You'll be able to see each other's posts and message again. Your connection isn't restored.`);
  if (!ok) return false;
  await clientApi(`/v1/profiles/${peerId}/block`, { method: block ? "POST" : "DELETE" });
  return true;
}

/** The "⋯" menu on someone else's profile: report or block them. */
export function ProfileMoreMenu({ peerId, name, blocked }: { peerId: string; name: string; blocked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function toggleBlock() {
    setOpen(false); setBusy(true);
    try { if (await setBlocked(peerId, name, !blocked)) router.refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <span ref={box} style={{ position: "relative" }}>
      <button type="button" className="btn btn-o" aria-label={`More options for ${name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={busy}>⋯</button>
      {open ? (
        <div className="card sf-menu" role="menu">
          <button role="menuitem" className="pmi" onClick={() => { setOpen(false); setReporting(true); }}>⚑ Report profile</button>
          <button role="menuitem" className="pmi" style={blocked ? undefined : { color: "var(--red)" }} onClick={toggleBlock}>{blocked ? "↺ Unblock" : "⛔ Block"} {name.split(" ")[0]}</button>
        </div>
      ) : null}
      {reporting ? <ReportDialog type="profile" id={peerId} name={name} onClose={() => setReporting(false)} /> : null}
    </span>
  );
}
