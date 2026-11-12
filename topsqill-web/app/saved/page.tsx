import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Empty, ListingCard } from "@/components/ui";
import type { Listing } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Homes I saved with ♡, newest first. Sold or unlisted ones stay, marked as such. */
export default async function SavedPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user || !token) redirect("/signin?next=/saved");
  const saved = await api<{ items: Listing[] }>("/v1/saved?type=listing", { token }).catch(() => ({ items: [] as Listing[] }));
  return (
    <Shell user={user} current="/saved">
      <h1 style={{ fontSize: 26, margin: "0 0 4px" }}>♥ Saved homes</h1>
      <p className="muted small" style={{ margin: "0 0 16px" }}>Homes you saved. You’ll get an alert when one of them drops its price.</p>
      {saved.items.length
        ? <div className="lgrid">{saved.items.map((l) => <ListingCard key={l.id} listing={l} />)}</div>
        : <Empty title="No saved homes yet" text="Tap ♡ Save on any listing to keep it here and hear about price drops."
            action={<Link href="/listings" className="btn btn-ai">Browse listings</Link>} />}
    </Shell>
  );
}
