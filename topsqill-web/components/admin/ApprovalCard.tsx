"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Verification } from "@/app/admin/approvals/page";

type Risk = { risk: string; score: number; checks: { label: string; ok: boolean }[]; note: string };
const RISK_COLOR: Record<string, string> = { low: "#12B76A", medium: "#E08A00", high: "#E5484D" };

/** One applicant: run the checks, then approve, ask for more, or reject. */
export function ApprovalCard({ verification }: { verification: Verification }) {
  const router = useRouter();
  const [risk, setRisk] = useState<Risk | null>(
    verification.risk ? { risk: verification.risk, score: verification.riskScore ?? 0, checks: verification.aiChecks ?? [], note: verification.aiNote ?? "" } : null,
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /** Documents are private: each view asks for a link that works for 15 minutes. */
  async function openDoc(label: string) {
    const tab = window.open("", "_blank");
    setBusy(`doc:${label}`);
    try {
      const { items } = await clientApi<{ items: { label: string; url: string | null }[] }>(`/v1/admin/verifications/${verification.id}/documents`);
      const url = items.find((i) => i.label === label && i.url)?.url;
      if (url && tab) tab.location.href = url; else { tab?.close(); alert("That document could not be opened."); }
    } catch (e) { tab?.close(); alert((e as Error).message); }
    finally { setBusy(null); }
  }
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function review() {
    setBusy("review"); setError("");
    try { setRisk(await clientApi<Risk>(`/v1/admin/verifications/${verification.id}/review`, { method: "POST" })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  async function decide(decision: "approved" | "rejected" | "info") {
    if (decision !== "approved" && !note.trim()) {
      setError("Add a short note so the applicant knows what to fix.");
      return;
    }
    setBusy(decision); setError("");
    try {
      await clientApi(`/v1/admin/verifications/${verification.id}/decide`, { method: "POST", body: { decision, note: note || undefined } });
      setDone(decision);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  if (done) {
    return (
      <div className="card pad row" style={{ opacity: .7 }}>
        <b>{verification.name}</b>
        <span className="muted small">
          {done === "approved" ? "Approved" : done === "rejected" ? "Rejected" : "More information requested"}
        </span>
      </div>
    );
  }

  return (
    <article className="card pad">
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link href={`/profile/${verification.userId}`} style={{ fontWeight: 800, fontSize: 17 }}>{verification.name}</Link>
            <span className="tag">{verification.kind.toUpperCase()}</span>
            <span className="tag">{verification.type}</span>
            {risk ? (
              <span className="pill" style={{ ["--c" as string]: RISK_COLOR[risk.risk] ?? "#8D8AA3" }}>
                {risk.risk} risk · {risk.score}
              </span>
            ) : null}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {[verification.agency, verification.city, verification.phone].filter(Boolean).join(" · ")}
            {verification.reraNumber ? ` · RERA ${verification.reraNumber}` : ""}
          </div>
          <div className="small muted">Submitted {timeAgo(verification.createdAt)}</div>
        </div>
        <button className="btn btn-o sm" onClick={review} disabled={busy !== null}>
          {busy === "review" ? "Checking…" : risk ? "Re-run checks" : "Run risk review"}
        </button>
      </div>

      {verification.documents?.length ? (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {verification.documents.map((d) => {
            const [label, mediaId] = d.split("|");
            return mediaId
              ? <button key={d} className="tag" onClick={() => openDoc(label)} disabled={busy === `doc:${label}`} title="Opens a private link valid for 15 minutes">📄 {label} · View</button>
              : <span key={d} className="tag">📄 {label}</span>;
          })}
        </div>
      ) : <p className="small muted" style={{ marginTop: 10 }}>No documents uploaded.</p>}

      {risk ? (
        <div className="card pad" style={{ background: "var(--soft)", marginTop: 12 }}>
          <div className="col" style={{ gap: 4 }}>
            {risk.checks.map((c) => (
              <div key={c.label} className="small row" style={{ gap: 8 }}>
                <span aria-hidden style={{ color: c.ok ? "#12B76A" : "#E5484D" }}>{c.ok ? "✓" : "✕"}</span>
                <span style={{ color: c.ok ? "var(--ink)" : "var(--red)" }}>{c.label}</span>
              </div>
            ))}
          </div>
          <p className="small" style={{ marginTop: 10, fontWeight: 700 }}>{risk.note}</p>
        </div>
      ) : null}

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor={`note-${verification.id}`}>Note to the applicant (required when rejecting or asking for more)</label>
        <textarea id={`note-${verification.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="For example: the Aadhaar upload is unreadable, please send a clearer copy." />
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
        <button className="btn btn-g sm" onClick={() => decide("info")} disabled={busy !== null}>Ask for more</button>
        <button className="btn btn-g sm" style={{ color: "var(--red)" }} onClick={() => decide("rejected")} disabled={busy !== null}>Reject</button>
        <button className="btn btn-p sm" onClick={() => decide("approved")} disabled={busy !== null}>
          {busy === "approved" ? "Approving…" : "Approve"}
        </button>
      </div>
    </article>
  );
}
