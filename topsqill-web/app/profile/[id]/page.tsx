import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Verified, ListingCard, Empty } from "@/components/ui";
import { ConnectButton } from "@/components/ConnectButton";
import { compact, imageUrl, TYPE_LABEL } from "@/lib/format";
import type { Listing, Paged } from "@/lib/types";

type Profile = {
  id: string; name: string; type: string; headline?: string | null; about?: string | null;
  city?: string | null; localities?: string[]; agency?: string | null; yearsExperience?: number | null;
  kycVerified?: boolean; reraVerified?: boolean; reraNumber?: string | null;
  connectionCount: number; followerCount: number; listingCount: number;
  avatar?: { urls?: Record<string, string> } | null; cover?: { urls?: Record<string, string> } | null;
  relation: "self" | "connected" | "pending" | "incoming" | "none";
  contact?: { phone?: string; email?: string } | null;
};

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const p = await api<Profile>(`/v1/profiles/${id}`, { revalidate: 60 }).catch(() => null);
  if (!p) return { title: "Profile not found" };
  return {
    title: `${p.name} | ${TYPE_LABEL[p.type] ?? p.type}`,
    description: p.headline ?? `${p.name} on Topsqill.ai`,
    alternates: { canonical: `/profile/${id}` },
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  const profile = await api<Profile>(`/v1/profiles/${id}`, token ? { token } : { revalidate: 60 }).catch(() => null);
  if (!profile) notFound();

  // Only this member's listings (the API filters by owner). On your own
  // profile, sold and unlisted ones are shown too, so you can edit or relist them.
  const own = !!user && user.id === id;
  const listings = own
    ? await api<{ items: Listing[] }>("/v1/listings/mine", { token }).catch(() => ({ items: [] as Listing[] }))
    : await api<Paged<Listing>>(`/v1/listings?ownerId=${encodeURIComponent(id)}&limit=24`, { revalidate: 30 })
      .catch(() => ({ items: [], nextCursor: null }));

  const cover = imageUrl(profile.cover, "large");
  const isMe = profile.relation === "self";

  return (
    <Shell user={user} current={isMe ? "/profile" : "/network"}>
      <div className="card" style={{ overflow: "hidden", marginBottom: 16 }}>
        <div style={{ height: 170, background: cover ? `center/cover no-repeat url(${cover})` : "var(--brand)" }} />
        <div className="pad" style={{ paddingTop: 0 }}>
          <div style={{ marginTop: -56 }}>
            <Avatar person={profile} media={profile.avatar as never} size={116} />
          </div>
          <div className="spread" style={{ marginTop: 10 }}>
            <div>
              <h1 className="row" style={{ fontSize: 28, gap: 10, flexWrap: "wrap" }}>
                {profile.name} <TypePill type={profile.type} />
              </h1>
              <p style={{ margin: "4px 0 6px", fontSize: 16 }}>{profile.headline}</p>
              <p className="muted small">
                {[...(profile.localities ?? []), profile.city].filter(Boolean).join(", ")}
                {" · "}{compact(profile.connectionCount)} connections
              </p>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <Verified person={profile} />
                {profile.reraVerified && profile.reraNumber ? <span className="tag">RERA {profile.reraNumber}</span> : null}
              </div>
            </div>
            <div className="row">
              {isMe
                ? <>
                    {!profile.kycVerified || (profile.type === "dealer" && !profile.reraVerified)
                      ? <Link href="/profile/verify" className="btn btn-ai">✓ Get verified</Link> : null}
                    <Link href="/profile/edit" className="btn btn-o">Edit profile</Link>
                  </>
                : <ConnectButton peerId={profile.id} relation={profile.relation} signedIn={!!user} />}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, margin: "18px 0 0" }}>
            {[["Listings", profile.listingCount], ["Connections", profile.connectionCount], ["Followers", profile.followerCount],
              ["Experience", profile.yearsExperience ? `${profile.yearsExperience} yrs` : "—"]].map(([l, v]) => (
              <div key={String(l)} style={{ background: "var(--soft)", borderRadius: 12, padding: "10px 12px" }}>
                <div className="small muted" style={{ fontWeight: 700 }}>{l as string}</div>
                <b style={{ fontSize: 18 }}>{compact(typeof v === "number" ? v : undefined) === "0" && typeof v !== "number" ? (v as string) : v as never}</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      {profile.about ? (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 19, marginBottom: 8 }}>About</h2>
          <p style={{ margin: 0, maxWidth: "72ch" }}>{profile.about}</p>
          {profile.agency ? <p className="muted small" style={{ marginTop: 12 }}>Works at <b>{profile.agency}</b></p> : null}
        </div>
      ) : null}

      {profile.contact?.phone ? (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 19, marginBottom: 8 }}>Contact</h2>
          <p className="small">📞 <a href={`tel:${profile.contact.phone}`}>{profile.contact.phone}</a></p>
          {profile.contact.email ? <p className="small">✉️ {profile.contact.email}</p> : null}
        </div>
      ) : profile.relation === "none" || profile.relation === "incoming" ? (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>
            Phone and email become visible once {profile.name.split(" ")[0]} accepts your connection.
          </p>
        </div>
      ) : null}

      <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>Listings</h2>
      {listings.items.length
        ? <div className="lgrid">{listings.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        : <Empty title={isMe ? "You haven’t listed anything yet" : "No listings yet"}
            text={isMe ? "Add your first property and it will appear here and in search." : undefined}
            action={isMe ? <Link href="/listings/new" className="btn btn-ai">Add a listing</Link> : undefined} />}
    </Shell>
  );
}
