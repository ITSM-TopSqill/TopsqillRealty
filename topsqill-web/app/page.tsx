import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, Empty, ListingCard, TypePill } from "@/components/ui";
import { Composer, PostCard } from "@/components/Feed";
import { inr, timeAgo, compact } from "@/lib/format";
import type { Listing, Paged, Post, Requirement } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Home: the feed for members, and a landing page for everyone else. */
export default async function HomePage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);

  if (!user) {
    const latest = await api<Paged<Listing>>("/v1/listings?limit=6", { revalidate: 60 }).catch(() => ({ items: [], nextCursor: null }));
    return (
      <Shell user={null} current="/">
        <section className="card pad" style={{ background: "var(--brand)", color: "#fff", border: 0, marginBottom: 20 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800 }}>Real estate, done together</h1>
          <p style={{ maxWidth: "58ch", margin: "10px 0 18px", opacity: .95 }}>
            Topsqill.ai is where dealers, builders, buyers and owners meet. Verified listings, buyer requirements,
            leads in one inbox, and AI that writes the boring parts for you.
          </p>
          <div className="row">
            <Link href="/signup" className="btn" style={{ background: "#fff", color: "#1F1D33" }}>Join Topsqill.ai</Link>
            <Link href="/listings" className="btn" style={{ border: "2px solid rgba(255,255,255,.7)", color: "#fff" }}>Browse listings</Link>
          </div>
        </section>
        <h2 style={{ fontSize: 22, margin: "0 0 12px" }}>Latest listings</h2>
        <div className="lgrid">{latest.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
      </Shell>
    );
  }

  const [feed, unreadNotifs, inbox, requirements] = await Promise.all([
    api<Paged<Post>>("/v1/feed?limit=12", { token }).catch(() => ({ items: [], nextCursor: null })),
    api<{ unread: number }>("/v1/notifications/unread", { token }).catch(() => ({ unread: 0 })),
    api<{ items: { unread: number }[] }>("/v1/conversations", { token }).catch(() => ({ items: [] })),
    api<Paged<Requirement>>(`/v1/requirements?limit=3${user.city ? `&city=${encodeURIComponent(user.city)}` : ""}`, { token })
      .catch(() => ({ items: [], nextCursor: null })),
  ]);
  const unreadMessages = inbox.items.reduce((n, c) => n + (c.unread ?? 0), 0);

  return (
    <Shell user={user} current="/" unread={{ messages: unreadMessages, notifications: unreadNotifs.unread }}>
      <div className="g3">
        <aside className="left sticky col">
          <div className="card" style={{ overflow: "hidden", textAlign: "center" }}>
            <div style={{ height: 60, background: "var(--brand)" }} />
            <div style={{ marginTop: -32 }}><Avatar person={user} media={user.avatar as never} size={66} /></div>
            <div className="pad" style={{ paddingTop: 8 }}>
              <h3 style={{ fontSize: 17 }}><Link href={`/profile/${user.id}`}>{user.name}</Link></h3>
              <p className="small muted" style={{ margin: "4px 0 8px" }}>{user.headline ?? "Complete your profile"}</p>
              <TypePill type={user.type} />
            </div>
            <div className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
              <span className="muted">Connections</span><b>{compact(user.connectionCount)}</b>
            </div>
            <div className="spread small" style={{ padding: "10px 16px", borderTop: "1px solid var(--line)" }}>
              <span className="muted">Listings</span><b>{compact(user.listingCount)}</b>
            </div>
          </div>
          <div className="card pad col" style={{ gap: 8 }}>
            <Link href="/listings/new" className="btn btn-ai sm">+ Add listing</Link>
            <Link href="/requirements/new" className="btn btn-o sm">Post a requirement</Link>
            <Link href="/leads" className="btn btn-g sm">My leads</Link>
          </div>
        </aside>

        <section className="col">
          <Composer user={user} />
          {feed.items.length
            ? feed.items.map((p) => <PostCard key={p.id} post={p} meId={user.id} />)
            : <Empty title="Your feed is quiet" text="Connect with dealers and builders in your city, and their updates will show up here."
                action={<Link href="/network" className="btn btn-ai">Find people</Link>} />}
        </section>

        <aside className="right sticky col">
          <div className="card pad">
            <h3 style={{ fontSize: 16, marginBottom: 10 }}>Buyers looking now</h3>
            {requirements.items.length ? requirements.items.map((r) => (
              <div key={r.id} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                <b className="small">{r.bhk ? `${r.bhk} BHK ` : ""}in {r.localities[0] ?? r.city}</b>
                <div className="small muted">
                  {inr(r.minPrice, r.purpose === "rent")} to {inr(r.maxPrice, r.purpose === "rent")} · {timeAgo(r.createdAt)}
                </div>
              </div>
            )) : <p className="small muted">No open requirements in your city yet.</p>}
            <Link href="/requirements" className="btn btn-g sm" style={{ marginTop: 10 }}>See all requirements</Link>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
