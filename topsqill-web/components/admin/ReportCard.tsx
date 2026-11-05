"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Report } from "@/app/admin/moderation/page";

/** One report: read the content, then hide it or leave it alone. */
export function ReportCard({ report }: { report: Report }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(!!report.target?.hidden);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function moderate(hide: boolean) {
    setBusy(true); setError("");
    try {
      await clientApi("/v1/admin/moderate", {
        method: "POST",
        body: { targetType: report.targetType, targetId: report.targetId, hide, reason: report.reason },
      });
      setHidden(hide);
      setDone(hide ? "Hidden" : "Kept and report dismissed");
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const link = report.targetType === "listing" ? `/listings/${report.targetId}`
    : report.targetType === "profile" ? `/profile/${report.targetId}` : null;

  return (
    <article className="card pad">
      <div className="spread">
        <div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="tag">{report.targetType}</span>
            <b>{report.reason}</b>
            {report.aiConfidence ? <span className="pill" style={{ ["--c" as string]: "#E08A00" }}>AI {report.aiConfidence}%</span> : null}
            {hidden ? <span className="pill" style={{ ["--c" as string]: "#E5484D" }}>Hidden</span> : null}
          </div>
          <div className="small muted">{timeAgo(report.createdAt)}</div>
        </div>
        {link ? <Link href={link} className="btn btn-g sm" target="_blank">Open</Link> : null}
      </div>

      {report.detail ? <p className="small" style={{ marginTop: 8 }}>Reporter’s note: {report.detail}</p> : null}
      {report.aiReason ? <p className="small muted" style={{ marginTop: 4 }}>AI: {report.aiReason}</p> : null}

      {report.target ? (
        <blockquote style={{ margin: "12px 0 0", padding: 12, background: "var(--soft)", borderRadius: 12, borderLeft: "3px solid var(--line)" }}>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{report.target.body ?? report.target.title ?? "(no preview)"}</p>
        </blockquote>
      ) : <p className="small muted" style={{ marginTop: 10 }}>The reported content is no longer available.</p>}

      {error ? <p className="error" style={{ marginTop: 8 }}>{error}</p> : null}
      {done ? <p className="small" style={{ color: "var(--grn)", fontWeight: 700, marginTop: 10 }}>{done}</p> : null}

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
        {hidden
          ? <button className="btn btn-o sm" onClick={() => moderate(false)} disabled={busy}>Restore</button>
          : <>
              <button className="btn btn-g sm" onClick={() => moderate(false)} disabled={busy}>Keep</button>
              <button className="btn btn-p sm" style={{ background: "var(--red)" }} onClick={() => moderate(true)} disabled={busy}>
                {busy ? "Hiding…" : "Hide"}
              </button>
            </>}
      </div>
    </article>
  );
}
