"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, TypePill } from "@/components/ui";
import { setBlocked } from "@/components/safety/Safety";
import { timeAgo } from "@/lib/format";

export type BlockedPerson = { id: string; name: string; type?: string; headline?: string | null; city?: string | null; avatar?: unknown; blockedAt: string };

/** Members I blocked, each with Unblock. */
export function BlockedList({ initial }: { initial: BlockedPerson[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function unblock(p: BlockedPerson) {
    setBusy(p.id);
    try { if (await setBlocked(p.id, p.name, false)) setItems((l) => l.filter((x) => x.id !== p.id)); }
    catch (e) { alert((e as Error).message); }
    finally { setBusy(null); }
  }

  if (!items.length) {
    return (
      <div className="card pad" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 34 }} aria-hidden>🛡</div>
        <b>You haven&apos;t blocked anyone</b>
        <p className="small muted" style={{ margin: "4px auto 0", maxWidth: "52ch" }}>To block someone, open their profile, or the ⋯ on one of their posts, and choose Block.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0 }}>
      {items.map((p, i) => (
        <div key={p.id} className="row" style={{ gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--line)" : 0 }}>
          <Avatar person={p as never} media={p.avatar as never} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 6 }}><Link href={`/profile/${p.id}`} style={{ fontWeight: 800 }} className="ell">{p.name}</Link><TypePill type={p.type} /></div>
            <div className="small muted ell">{[p.headline, p.city].filter(Boolean).join(" · ")}</div>
            <div className="small muted">Blocked {timeAgo(p.blockedAt)}</div>
          </div>
          <button className="btn btn-o sm" onClick={() => unblock(p)} disabled={busy === p.id}>{busy === p.id ? "…" : "Unblock"}</button>
        </div>
      ))}
    </div>
  );
}
