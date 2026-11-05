"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";

type Fit = { score: number; strengths: string[]; gaps: string[]; tip: string };

/** Check the fit, then apply. The note can be written by AI. */
export function ApplyPanel({ jobId, signedIn }: { jobId: string; signedIn: boolean }) {
  const [fit, setFit] = useState<Fit | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState<"fit" | "apply" | null>(null);
  const [error, setError] = useState("");

  if (!signedIn) return <Link href="/signin" className="btn btn-ai">Sign in to apply</Link>;
  if (applied) return <p className="btn btn-g" style={{ cursor: "default" }}>✓ Application sent</p>;

  async function checkFit() {
    setBusy("fit"); setError("");
    try { setFit(await clientApi<Fit>(`/v1/jobs/${jobId}/fit`)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function apply() {
    setBusy("apply"); setError("");
    try {
      await clientApi(`/v1/jobs/${jobId}/apply`, { method: "POST", body: { note, phone } });
      setApplied(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-ai" onClick={() => setOpen(true)}>Apply</button>
        <button className="btn btn-o" onClick={checkFit} disabled={busy !== null}>
          {busy === "fit" ? "Checking…" : "✨ How well do I match?"}
        </button>
      </div>

      {fit ? (
        <div className="card pad" style={{ background: "var(--soft)" }}>
          <b>Match {fit.score}%</b>
          {fit.strengths.length ? <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{fit.strengths.map((s) => <li key={s}>{s}</li>)}</ul> : null}
          {fit.gaps.length ? <p className="small" style={{ color: "var(--amber)", marginTop: 8 }}>{fit.gaps.join(". ")}</p> : null}
          <p className="small muted" style={{ marginTop: 6 }}>{fit.tip}</p>
        </div>
      ) : null}

      {open ? (
        <div className="card pad col">
          <div className="field">
            <label htmlFor="apply-phone">Phone</label>
            <input id="apply-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          </div>
          <div className="field">
            <label htmlFor="apply-note">A short note to the hiring team</label>
            <textarea id="apply-note" rows={5} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Why you would be a good fit" />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-g sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-p sm" onClick={apply} disabled={busy !== null}>
              {busy === "apply" ? "Sending…" : "Send application"}
            </button>
          </div>
        </div>
      ) : null}
      {!open && error ? <p className="error">{error}</p> : null}
    </div>
  );
}
