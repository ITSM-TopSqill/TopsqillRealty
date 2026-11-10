"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { refreshPages } from "@/lib/refresh";

/** Edit, close (role filled) or reopen your own job post. */
export function JobOwnerActions({ id, open }: { id: string; open: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (open && !confirm("Close this job? It leaves the jobs board and stops taking applications. You can reopen it later.")) return;
    setBusy(true); setError("");
    try {
      await clientApi(`/v1/jobs/${id}`, { method: "PATCH", body: { status: open ? "closed" : "open" } });
      await refreshPages([`/jobs/${id}`, "/jobs"]);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <span className="small">This is your job post{open ? ". Applicants are listed below." : ", and it is closed."}</span>
      <Link href={`/jobs/${id}/edit`} className="btn btn-ai sm">✏️ Edit job</Link>
      <button className="btn btn-o sm" onClick={toggle} disabled={busy}>{busy ? "Saving…" : open ? "Close job" : "Reopen job"}</button>
      {error ? <span className="error small" role="alert">{error}</span> : null}
    </div>
  );
}
