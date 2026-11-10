"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { refreshPages } from "@/lib/refresh";

/** Edit, close or reopen one of your own requirements. */
export function RequirementActions({ id, closed = false }: { id: string; closed?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (!closed && !confirm("Close this requirement? It leaves the board and dealers stop seeing it. You can reopen it later.")) return;
    setBusy(true); setError("");
    try {
      if (closed) await clientApi(`/v1/requirements/${id}`, { method: "PATCH", body: { status: "active" } });
      else await clientApi(`/v1/requirements/${id}`, { method: "DELETE" });
      await refreshPages(["/requirements"]);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      {!closed ? <Link href={`/requirements/${id}/edit`} className="btn btn-o sm">✏️ Edit</Link> : null}
      <button className="btn btn-g sm" onClick={run} disabled={busy}>{busy ? "Saving…" : closed ? "Reopen" : "Close"}</button>
      {error ? <span className="error small" role="alert">{error}</span> : null}
    </span>
  );
}
