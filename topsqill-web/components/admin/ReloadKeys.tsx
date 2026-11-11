"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/** Re-reads the api.sh keys now, and gives keys that had failed another try. */
export function ReloadKeys() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="btn btn-g sm" disabled={busy} onClick={async () => {
        setBusy(true); setNote("");
        try {
          const r = await clientApi<{ keys: unknown[]; source: string }>("/v1/admin/scraper/reload", { method: "POST" });
          setNote(`${r.keys.length} key${r.keys.length === 1 ? "" : "s"} loaded`);
          router.refresh();
        } catch (e) { setNote((e as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Reloading…" : "Reload keys"}</button>
      {note ? <span className="small muted">{note}</span> : null}
    </span>
  );
}
