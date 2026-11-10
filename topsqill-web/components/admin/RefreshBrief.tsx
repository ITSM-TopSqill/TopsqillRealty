"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** Writes today's brief again with the latest numbers. */
export function RefreshBrief() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-g sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await clientApi("/v1/admin/ai/brief?refresh=1"); router.refresh(); } catch { /* the page keeps the last brief */ }
      finally { setBusy(false); }
    }}>{busy ? "Writing…" : "Refresh"}</button>
  );
}
