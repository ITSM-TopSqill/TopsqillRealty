import Link from "next/link";
import { Avatar, TypePill } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { NetPerson } from "./types";

/** One person in a list: photo, name, kind, badges, headline, and a line of context. Actions sit on the right. */
export function PersonRow({ p, meta, children }: { p: NetPerson; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="nw-row">
      <Link href={`/profile/${p.id}`} className="nw-av" aria-label={p.name}><Avatar person={p} media={p.avatar ?? null} size={56} /></Link>
      <div className="nw-who">
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Link href={`/profile/${p.id}`} className="nw-name">{p.name}</Link>
          <TypePill type={p.type} />
          {p.kycVerified ? <span className="nw-badge" title="KYC verified" style={{ color: "#4A86D4" }}>✓ KYC</span> : null}
          {p.reraVerified ? <span className="nw-badge" title="RERA verified" style={{ color: "#2E9E90" }}>✓ RERA</span> : null}
        </div>
        {p.headline || p.agency ? <div className="nw-head">{p.headline || p.agency}</div> : null}
        <div className="nw-meta">
          {[p.city ? `📍 ${p.city}` : null, p.mutual ? `👥 ${p.mutual} mutual` : null].filter(Boolean).join(" · ")}
          {meta ? <>{p.city || p.mutual ? " · " : ""}{meta}</> : null}
        </div>
      </div>
      {children ? <div className="nw-act">{children}</div> : null}
    </div>
  );
}

export const since = (iso?: string) => (iso ? timeAgo(iso) : "");
