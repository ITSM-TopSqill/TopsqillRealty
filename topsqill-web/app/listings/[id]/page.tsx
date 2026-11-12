import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Verified } from "@/components/ui";
import { ContactOwner } from "@/components/ContactOwner";
import { SaveButton } from "@/components/SaveButton";
import { priceDrop } from "@/lib/price-drop";
import { ListingOwnerBar } from "@/components/ListingOwnerBar";
import { ListingAsk } from "@/components/ListingAsk";
import { Gallery } from "@/components/Gallery";
import { ListingExtras } from "@/components/ListingExtras";
import { HomeViews } from "@/components/HomeViews";
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
  const [listing, user, token] = await Promise.all([
    api<Listing>(`/v1/listings/${id}`, { revalidate: 60 }).catch(() => null),
    getUser(),
    getToken(),
  ]);
  if (!listing) notFound();
  const saved = token ? (await api<{ saved: boolean }>(`/v1/saved/check?type=listing&id=${encodeURIComponent(id)}`, { token }).catch(() => ({ saved: false }))).saved : false;
  const drop = priceDrop(listing);

  const rent = listing.purpose === "rent";
  const ownerId = listing.owner?.id ?? listing.ownerId ?? "";
  const mine = !!user && user.id === ownerId;
  const status = (listing.status ?? "active") as "active" | "sold" | "archived";
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
    geo: listing.lat != null && listing.lng != null ? { "@type": "GeoCoordinates", latitude: listing.lat, longitude: listing.lng } : undefined,
  };

  return (
    <Shell user={user} current="/listings">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {status !== "active" ? (
        <div className="card pad" role="status" style={{ marginBottom: 12, background: "var(--soft)", fontWeight: 700 }}>
          {status === "sold" ? (rent ? "🔑 This home has been rented." : "🤝 This property has been sold.") : "This listing is no longer on the market."}
          {mine ? <span className="small muted" style={{ fontWeight: 400 }}> Only you can still find it from your profile. Relist it below to put it back on the market.</span> : null}
        </div>
      ) : null}
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
              {drop ? (
                <div className="small" style={{ marginTop: 4 }}>
                  <span className="tag" style={{ background: "#E03E52", color: "#fff" }}>↓ Price drop {drop.pct}%</span>{" "}
                  <s className="muted">{inr(drop.from, rent)}</s> <span style={{ color: "#E03E52", fontWeight: 700 }}>save {inr(drop.cut)}</span>
                </div>
              ) : null}
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

      <HomeViews title={listing.title} kind={listing.kind} bhk={listing.bhk} areaSqft={listing.areaSqft} facing={listing.facing} />
      <ListingExtras title={listing.title} videoUrl={listing.videoUrl} tourUrl={listing.tourUrl} lat={listing.lat} lng={listing.lng} locality={`${listing.locality}, ${listing.city}`} />

      {!mine && status === "active" ? <ListingAsk listingId={listing.id} signedIn={!!user} rent={rent} /> : null}

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
        {mine
          ? <ListingOwnerBar id={listing.id} ownerId={ownerId} status={status} rent={rent} />
          : status === "active" ? (
            <div className="row" style={{ gap: 8 }}>
              <SaveButton listingId={listing.id} initial={saved} signedIn={!!user} />
              <ContactOwner listingId={listing.id} ownerId={ownerId} signedIn={!!user} title={listing.title} />
            </div>
          ) : null}
      </div>
    </Shell>
  );
}
