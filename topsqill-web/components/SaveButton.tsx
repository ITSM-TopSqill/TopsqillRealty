"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** ♡ Save / ♥ Saved on a listing. Saved homes are listed under Me → Saved homes. */
export function SaveButton({ listingId, initial, signedIn, compact = false }: { listingId: string; initial: boolean; signedIn: boolean; compact?: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!signedIn) { router.push(`/signin?next=/listings/${listingId}`); return; }
    const next = !saved;
    setSaved(next); setBusy(true);
    try {
      await clientApi("/v1/saved", { method: next ? "POST" : "DELETE", body: { itemType: "listing", itemId: listingId } });
    } catch { setSaved(!next); }
    finally { setBusy(false); }
  }
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={saved} aria-label={saved ? "Remove from saved homes" : "Save this home"}
      className={compact ? "pill" : "btn btn-o"} style={compact ? { background: "rgba(255,255,255,.94)", color: saved ? "#d6336c" : "#1F1D33", border: 0, cursor: "pointer" } : { color: saved ? "#d6336c" : undefined }}>
      {saved ? "♥ Saved" : "♡ Save"}
    </button>
  );
}
