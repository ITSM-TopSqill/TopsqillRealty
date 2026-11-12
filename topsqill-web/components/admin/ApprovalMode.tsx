"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

const MODES = [["all", "Review every listing"], ["unverified", "Review only members without KYC"], ["off", "Publish without review"]] as const;

/** Which listings need an admin's approval before going live. */
export function ApprovalMode({ current }: { current: "all" | "unverified" | "off" }) {
  const router = useRouter();
  const [mode, setMode] = useState(current);
  const [busy, setBusy] = useState(false);
  async function change(next: typeof current) {
    if (next === "off" && !confirm("New listings will go live straight away, without review. Continue?")) return;
    setBusy(true);
    try { await clientApi("/v1/admin/listings/settings", { method: "POST", body: { approval: next } }); setMode(next); router.refresh(); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <label className="small" style={{ display: "grid", gap: 4 }}>
      <b>Approval needed for</b>
      <select value={mode} disabled={busy} onChange={(e) => change(e.target.value as typeof current)} style={{ minWidth: 260 }}>
        {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );
}
