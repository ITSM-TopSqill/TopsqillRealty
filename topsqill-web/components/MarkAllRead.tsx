"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-g sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await clientApi("/v1/notifications/read-all", { method: "POST" }); router.refresh(); }
      finally { setBusy(false); }
    }}>
      Mark all as read
    </button>
  );
}
