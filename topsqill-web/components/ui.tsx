import Link from "next/link";
import { imageUrl, initials, TYPE_COLOR, TYPE_LABEL, inr, sqft, timeAgo } from "@/lib/format";
import type { Listing, Media, PersonCard } from "@/lib/types";

/** Avatar. Falls back to initials, which is what most new members will have. */
export function Avatar({ person, size = 44, media }: { person?: PersonCard | { id: string; name: string; type?: string } | null; size?: number; media?: Media | null }) {
  const url = imageUrl(media, size <= 48 ? "thumb" : "card");
  const ring = TYPE_COLOR[(person as PersonCard)?.type ?? ""] ?? "#8B4FEA";
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36), boxShadow: `0 0 0 2.5px var(--card), 0 0 0 4.5px ${ring}` };
  const className = `av ${(person as PersonCard)?.type === "builder" ? "sq" : ""}`;
  if (url) return <img className={className} style={style} src={url} alt={person?.name ?? ""} loading="lazy" />;
  return <span className={className} style={style} aria-hidden>{initials(person?.name)}</span>;
}

export function TypePill({ type }: { type?: string | null }) {
  if (!type) return null;
  return <span className="pill" style={{ ["--c" as string]: TYPE_COLOR[type] ?? "#8B4FEA" }}>{TYPE_LABEL[type] ?? type}</span>;
}

export function Verified({ person }: { person?: { kycVerified?: boolean; reraVerified?: boolean } | null }) {
  if (!person) return null;
  return (
    <>
      {person.kycVerified && <span className="tag" title="KYC verified" style={{ color: "#4A86D4" }}>✓ KYC</span>}
      {person.reraVerified && <span className="tag" title="RERA verified" style={{ color: "#2E9E90" }}>✓ RERA</span>}
    </>
  );
}

/** The listing card used on the search page, profiles and saved items. */
export function ListingCard({ listing }: { listing: Listing }) {
  const url = imageUrl(listing.cover, "card");
  const rent = listing.purpose === "rent";
  return (
    <Link href={`/listings/${listing.id}`} className="card lc" style={{ textDecoration: "none" }}>
      <div className="art">
        {url
          ? <img src={url} alt={listing.title} loading="lazy" />
          : <div style={{ width: "100%", height: "100%", background: "var(--brand)", opacity: 0.15 }} />}
        <span className="pill" style={{ position: "absolute", left: 12, top: 12, background: "rgba(255,255,255,.94)", color: "#1F1D33" }}>
          {rent ? "For rent" : "For sale"}
        </span>
      </div>
      <div className="lb">
        <div className="lp">{inr(listing.priceInr, rent)}</div>
        <div className="lt">{listing.title}</div>
        <div className="small muted">📍 {listing.locality}, {listing.city}</div>
        <div className="spec">
          {listing.bhk ? <span>🛏 {listing.bhk} BHK</span> : null}
          {listing.areaSqft ? <span>📐 {sqft(listing.areaSqft)}</span> : null}
          {listing.possession ? <span>🔑 {listing.possession === "Ready to move" ? "Ready" : "Under constr."}</span> : null}
        </div>
        <div className="lf">
          {listing.owner ? <Avatar person={listing.owner} size={26} /> : null}
          <span style={{ flex: 1, minWidth: 0, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {listing.owner?.name ?? "Topsqill.ai member"}
          </span>
          <span className="muted small">{timeAgo(listing.publishedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="card empty">
      <h3 style={{ fontSize: 19, marginBottom: 6 }}>{title}</h3>
      {text ? <p style={{ margin: "0 0 14px", maxWidth: "52ch", marginInline: "auto" }}>{text}</p> : null}
      {action}
    </div>
  );
}

/** Shown while a page's data is still loading. */
export function Skeleton({ height = 120, count = 3 }: { height?: number; count?: number }) {
  return (
    <div className="col">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" style={{ height, background: "linear-gradient(90deg,var(--chip),var(--soft),var(--chip))" }} />
      ))}
    </div>
  );
}
