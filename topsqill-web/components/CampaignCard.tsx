"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientApi } from "@/lib/api";
import { inr, timeAgo, CAMPAIGN_COLOR } from "@/lib/format";
import type { Campaign } from "@/lib/types";

const LABEL: Record<string, string> = { draft: "Draft", review: "In review", rejected: "Not approved", active: "Live", paused: "Paused", completed: "Finished", scheduled: "Scheduled" };

/** One row on the campaigns list: opens the campaign, with Delete for a draft or rejected one. */
export function CampaignCard({ c }: { c: Campaign }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canDelete = c.status === "draft" || c.status === "rejected";

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    setBusy(true);
    try { await clientApi(`/v1/campaigns/${c.id}`, { method: "DELETE" }); router.refresh(); }
    catch (err) { alert((err as Error).message); setBusy(false); }
  }

  return (
    <Link href={`/campaigns/${c.id}`} className="card pad" style={{ textDecoration: "none", position: "relative", display: "block" }}>
      <div className="spread" style={{ gap: 8 }}>
        <b className="ell">{c.name}</b>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          <span className="pill" style={{ background: `color-mix(in srgb,${CAMPAIGN_COLOR[c.status] ?? "#8D8AA3"} 16%,transparent)`, color: CAMPAIGN_COLOR[c.status] }}>
            {LABEL[c.status] ?? c.status}
          </span>
          {canDelete ? (
            <button type="button" className="btn btn-g sm" aria-label={`Delete ${c.name}`} onClick={remove} disabled={busy} style={{ padding: "2px 8px" }}>
              {busy ? "…" : "🗑"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {inr(c.budgetInr)} over {c.days} days · {c.status === "draft" ? `forecast ${c.forecast?.leads ?? 0} leads` : `${c.leadsCount} leads, ${c.qualifiedCount} qualified`} · created {timeAgo(c.createdAt)}
      </div>
    </Link>
  );
}
