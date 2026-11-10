"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";
import { refreshPages } from "@/lib/refresh";

type Status = "active" | "sold" | "archived";

/** Shown to the owner on their own listing, in place of "Contact seller". */
export function ListingOwnerBar({ id, ownerId, status, rent }: { id: string; ownerId: string; status: Status; rent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const closed = rent ? "rented" : "sold";

  async function set(next: Status) {
    if (next === "archived" && !confirm("Unlist this listing? It leaves search and your profile until you relist it.")) return;
    setBusy(next); setError("");
    try {
      await clientApi(`/v1/listings/${id}`, { method: "PATCH", body: { status: next } });
      await refreshPages([`/listings/${id}`, "/listings", `/profile/${ownerId}`]);
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div className="col" style={{ gap: 6, alignItems: "flex-end" }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Link href={`/listings/${id}/edit`} className="btn btn-ai">✏️ Edit listing</Link>
        {status === "active" ? (
          <>
            <button className="btn btn-o" onClick={() => set("sold")} disabled={!!busy}>{busy === "sold" ? "Saving…" : `Mark as ${closed}`}</button>
            <button className="btn btn-g" onClick={() => set("archived")} disabled={!!busy}>{busy === "archived" ? "Saving…" : "Unlist"}</button>
          </>
        ) : (
          <button className="btn btn-o" onClick={() => set("active")} disabled={!!busy}>{busy === "active" ? "Saving…" : "Relist"}</button>
        )}
      </div>
      <span className="small muted">This is your listing{status === "active" ? "" : status === "sold" ? ` (marked ${closed})` : " (unlisted)"}.</span>
      {error ? <p className="error small" role="alert">{error}</p> : null}
    </div>
  );
}
