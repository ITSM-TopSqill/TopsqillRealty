import { redirect } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Avatar, TypePill, Empty } from "@/components/ui";
import { ConnectButton } from "@/components/ConnectButton";
import { AcceptIgnore } from "@/components/AcceptIgnore";
import type { PersonCard } from "@/lib/types";

export const metadata = { title: "My Network" };
export const dynamic = "force-dynamic";

export default async function NetworkPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin");

  const [pending, connected, suggestions] = await Promise.all([
    api<{ items: PersonCard[] }>("/v1/connections?status=pending", { token }).catch(() => ({ items: [] })),
    api<{ items: PersonCard[] }>("/v1/connections?status=accepted", { token }).catch(() => ({ items: [] })),
    api<{ people: PersonCard[] }>(`/v1/search?q=${encodeURIComponent(user.city ?? "dealer")}&limit=8`, { token })
      .catch(() => ({ people: [] })),
  ]);

  const connectedIds = new Set(connected.items.map((p) => p.id));
  const people = (suggestions.people ?? []).filter((p) => p.id !== user.id && !connectedIds.has(p.id));

  return (
    <Shell user={user} current="/network">
      <h1 style={{ fontSize: 26, marginBottom: 14 }}>My Network</h1>

      <section className="card pad" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>Invitations ({pending.items.length})</h2>
        {pending.items.length ? pending.items.map((p) => (
          <div key={p.id} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
            <Avatar person={p} size={50} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <Link href={`/profile/${p.id}`} style={{ fontWeight: 800 }}>{p.name}</Link>
                <TypePill type={p.type} />
              </div>
              <div className="small muted">{p.headline}</div>
            </div>
            <AcceptIgnore peerId={p.id} />
          </div>
        )) : <p className="small muted">You’re all caught up. New invitations appear here.</p>}
      </section>

      <section className="card pad">
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>People you may know</h2>
        {people.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14 }}>
            {people.map((p) => (
              <div key={p.id} className="card pad" style={{ textAlign: "center" }}>
                <Avatar person={p} size={66} />
                <div style={{ marginTop: 8 }}>
                  <Link href={`/profile/${p.id}`} style={{ fontWeight: 800 }}>{p.name}</Link>
                </div>
                <TypePill type={p.type} />
                <p className="small muted" style={{ minHeight: 34, margin: "6px 0 10px" }}>{p.headline}</p>
                <ConnectButton peerId={p.id} relation="none" signedIn />
              </div>
            ))}
          </div>
        ) : <Empty title="No suggestions yet" text="As more members join your city, they will appear here." />}
      </section>
    </Shell>
  );
}

