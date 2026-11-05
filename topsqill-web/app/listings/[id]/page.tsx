import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Verified } from "@/components/ui";
import { ContactOwner } from "@/components/ContactOwner";
import { Gallery } from "@/components/Gallery";
import { inr, sqft, imageUrl, timeAgo } from "@/lib/format";
import type { Listing } from "@/lib/types";

export const revalidate = 60;

/** Listing pages are public and indexed, so each one carries its own metadata. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const listing = await api<Listing>(`/v1/listings/${id}`, { revalidate: 60 }).catch(() => null);
  if (!listing) return { title: "Listing not found" };
  const price = inr(listing.priceInr, listing.purpose === "rent");
  const title = `${listing.title} | ${price}`;
  const description = `${listing.bhk ? `${listing.bhk} BHK ` : ""}${listing.kind} in ${listing.locality}, ${listing.city}. ${sqft(listing.areaSqft)}. ${price}.`;
  const image = imageUrl(listing.cover ?? listing.media?.[0], "large");
  return {
    title, description,
    alternates: { canonical: `/listings/${id}` },
    openGraph: { title, description, images: image ? [image] : [], type: "article" },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [listing, user] = await Promise.all([
    api<Listing>(`/v1/listings/${id}`, { revalidate: 60 }).catch(() => null),
    getUser(),
  ]);
  if (!listing) notFound();

  const rent = listing.purpose === "rent";
  const rate = listing.priceInr && listing.areaSqft ? Math.round(listing.priceInr / listing.areaSqft) : null;

  // Structured data, so Google can show the price and location in results.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: listing.title,
    description: listing.description ?? undefined,
    url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://topsqill.ai"}/listings/${listing.id}`,
    image: imageUrl(listing.cover, "large") ?? undefined,
    datePosted: listing.publishedAt ?? undefined,
    address: { "@type": "PostalAddress", addressLocality: listing.locality, addressRegion: listing.city, addressCountry: "IN" },
    offers: listing.priceInr ? { "@type": "Offer", price: listing.priceInr, priceCurrency: "INR" } : undefined,
    floorSize: listing.areaSqft ? { "@type": "QuantitativeValue", value: listing.areaSqft, unitCode: "FTK" } : undefined,
    numberOfRooms: listing.bhk ?? undefined,
  };

  return (
    <Shell user={user} current="/listings">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <Gallery media={listing.media ?? (listing.cover ? [listing.cover] : [])} title={listing.title} />
        <div className="pad">
          <div className="spread">
            <div>
              <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                {listing.verified ? <span className="tag" style={{ color: "#2E9E90" }}>✓ Verified listing</span> : null}
                {listing.reraNumber ? <span className="tag">RERA {listing.reraNumber}</span> : null}
                <span className="tag">{rent ? "For rent" : "For sale"}</span>
              </div>
              <h1 style={{ fontSize: 28 }}>{listing.title}</h1>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                📍 {listing.locality}, {listing.city}
                {listing.publishedAt ? ` · posted ${timeAgo(listing.publishedAt)}` : ""}
                {listing.viewCount ? ` · ${listing.viewCount.toLocaleString("en-IN")} views` : ""}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ font: '800 30px/1.1 "Bricolage Grotesque", system-ui, sans-serif' }}>{inr(listing.priceInr, rent)}</div>
              {rate && !rent ? <div className="small muted">₹{rate.toLocaleString("en-IN")} per sq ft</div> : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, margin: "18px 0" }}>
            {[
              ["Type", listing.kind],
              ["Bedrooms", listing.bhk ? `${listing.bhk} BHK` : "n/a"],
              ["Area", sqft(listing.areaSqft) || "n/a"],
              ["Possession", listing.possession ?? "Ask the seller"],
              ["Furnishing", listing.furnishing ?? "n/a"],
              ["Facing", listing.facing ?? "n/a"],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px" }}>
                <div className="small muted" style={{ fontWeight: 700 }}>{label}</div>
                <b>{value}</b>
              </div>
            ))}
          </div>

          {listing.description ? <p style={{ maxWidth: "72ch" }}>{listing.description}</p> : null}

          {listing.usps?.length ? (
            <>
              <h3 style={{ fontSize: 17, margin: "18px 0 8px" }}>Why buyers like it</h3>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {listing.usps.map((u) => <span key={u} className="tag">★ {u}</span>)}
              </div>
            </>
          ) : null}

          {listing.amenities?.length ? (
            <>
              <h3 style={{ fontSize: 17, margin: "18px 0 8px" }}>Amenities</h3>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {listing.amenities.map((a) => <span key={a} className="tag">{a}</span>)}
              </div>
            </>
          ) : null}

          {listing.projectSourceId ? (
            <Link href={`/projects/${listing.projectSourceId}`} className="btn btn-o" style={{ marginTop: 18 }}>
              Open the full project report
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card pad spread">
        <div className="row">
          <Avatar person={listing.owner} size={52} />
          <div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <Link href={`/profile/${listing.owner?.id ?? listing.ownerId}`} style={{ fontWeight: 800 }}>
                {listing.owner?.name ?? "Topsqill.ai member"}
              </Link>
              <TypePill type={listing.owner?.type} />
              <Verified person={listing.owner} />
            </div>
            <div className="small muted">{listing.owner?.headline}</div>
          </div>
        </div>
        <ContactOwner listingId={listing.id} ownerId={listing.owner?.id ?? listing.ownerId ?? ""} signedIn={!!user} title={listing.title} />
      </div>
    </Shell>
  );
}
