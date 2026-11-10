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

  const [pending, sent, connected, suggestions] = await Promise.all([
    api<{ items: PersonCard[] }>("/v1/connections?status=pending", { token }).catch(() => ({ items: [] })),
    api<{ items: PersonCard[] }>("/v1/connections?status=sent", { token }).catch(() => ({ items: [] })),
    api<{ items: PersonCard[] }>("/v1/connections?status=accepted&limit=100", { token }).catch(() => ({ items: [] })),
    api<{ items: (PersonCard & { mutual?: number })[] }>("/v1/connections/suggestions", { token }).catch(() => ({ items: [] })),
  ]);
  const people = suggestions.items;

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

      {sent.items.length ? (
        <section className="card pad" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, marginBottom: 10 }}>Sent ({sent.items.length})</h2>
          {sent.items.map((p) => (
            <div key={p.id} className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <Avatar person={p} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <Link href={`/profile/${p.id}`} style={{ fontWeight: 800 }}>{p.name}</Link>
                  <TypePill type={p.type} />
                </div>
                <div className="small muted">{p.headline}</div>
              </div>
              <span className="small muted">Waiting for a reply</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card pad" style={{ marginBottom: 16 }}>
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
                <p className="small muted" style={{ minHeight: 34, margin: "6px 0 4px" }}>{p.headline}</p>
                <p className="small muted" style={{ margin: "0 0 10px" }}>{p.mutual ? `${p.mutual} mutual connection${p.mutual === 1 ? "" : "s"}` : p.city ?? ""}</p>
                <ConnectButton peerId={p.id} relation="none" signedIn compact />
              </div>
            ))}
          </div>
        ) : <Empty title="No suggestions right now" text="You’re connected with everyone we could suggest. New members will appear here." />}
      </section>

      <section className="card pad">
        <h2 style={{ fontSize: 18, marginBottom: 10 }}>Your connections ({connected.items.length})</h2>
        {connected.items.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 4 }}>
            {connected.items.map((p) => (
              <Link key={p.id} href={`/profile/${p.id}`} className="row" style={{ padding: "8px 6px", borderRadius: 12, textDecoration: "none" }}>
                <Avatar person={p} size={40} />
                <div style={{ minWidth: 0 }}>
                  <b className="small">{p.name}</b>
                  <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.headline}</div>
                </div>
              </Link>
            ))}
          </div>
        ) : <p className="small muted">Connect with dealers, builders and buyers above, and they will appear here.</p>}
      </section>
    </Shell>
  );
}

