"use client";

import { useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui";

export type Applicant = {
  id: string; status: string; matchScore?: number | null; note?: string | null; phone?: string | null; email?: string | null;
  yearsExperience?: number | null; noticePeriod?: string | null; createdAt: string;
  userId: string; name: string; headline?: string | null; city?: string | null;
};

const LABEL: Record<string, string> = { applied: "New", viewed: "Viewed", shortlisted: "Shortlisted", rejected: "Not a fit", hired: "Hired" };
const COLOR: Record<string, string> = { applied: "#2F7FE6", viewed: "#8D8AA3", shortlisted: "#6A3FE0", rejected: "#E5484D", hired: "#12B76A" };

/** The employer's view of a job: applicants, best match first, with a status for each. Applicants are alerted on every change. */
export function Applicants({ items }: { items: Applicant[] }) {
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function set(id: string, status: string) {
    setBusy(id); setError("");
    try {
      await clientApi(`/v1/jobs/applications/${id}/status`, { method: "POST", body: { status } });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 19, marginBottom: 10 }}>Applicants ({rows.length})</h2>
      {error ? <p className="error small">{error}</p> : null}
      {rows.length ? rows.map((a) => (
        <div key={a.id} className="row" style={{ alignItems: "flex-start", gap: 12, padding: "12px 0", borderTop: "1px solid var(--line)" }}>
          <Avatar person={{ id: a.userId, name: a.name }} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="spread" style={{ flexWrap: "wrap", gap: 6 }}>
              <Link href={`/profile/${a.userId}`} style={{ fontWeight: 800 }}>{a.name}</Link>
              <span className="pill" style={{ background: `color-mix(in srgb,${COLOR[a.status]} 15%,transparent)`, color: COLOR[a.status] }}>{LABEL[a.status] ?? a.status}</span>
            </div>
            <div className="small muted">{a.headline}</div>
            <div className="small" style={{ marginTop: 4 }}>
              {a.matchScore ? <b style={{ color: "#0E9F6E" }}>{a.matchScore}% match</b> : null}
              {a.yearsExperience != null ? ` · ${a.yearsExperience} yrs` : ""}{a.noticePeriod ? ` · notice ${a.noticePeriod}` : ""} · applied {timeAgo(a.createdAt)}
            </div>
            {a.note ? <p className="small" style={{ margin: "6px 0 0", background: "var(--soft)", borderRadius: 10, padding: "8px 10px" }}>{a.note}</p> : null}
            {a.phone || a.email ? <div className="small muted" style={{ marginTop: 4 }}>{a.phone ? <a href={`tel:${a.phone}`}>{a.phone}</a> : null}{a.phone && a.email ? " · " : ""}{a.email}</div> : null}
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {(["shortlisted", "hired", "rejected"] as const).filter((s) => s !== a.status).map((s) => (
                <button key={s} className={`btn sm ${s === "rejected" ? "btn-g" : "btn-o"}`} disabled={busy === a.id} onClick={() => set(a.id, s)}>
                  {s === "shortlisted" ? "Shortlist" : s === "hired" ? "Mark hired" : "Not a fit"}
                </button>
              ))}
            </div>
          </div>
        </div>
      )) : <p className="small muted">No applicants yet. Share the job with your network to get more.</p>}
    </div>
  );
}
