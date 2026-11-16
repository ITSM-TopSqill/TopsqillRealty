"use client";

import { useState } from "react";
import { clientApi } from "@/lib/api";
import { ListingCard } from "./ui";
import type { Listing, Paged } from "@/lib/types";

/**
 * More listings below the first page, added to the grid as they're fetched -
 * not a new page that replaces the ones already shown.
 */
export function MoreListings({ cursor, query }: { cursor: string | null; query: string }) {
  const [items, setItems] = useState<Listing[]>([]);
  const [next, setNext] = useState(cursor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!next) return;
    setBusy(true); setError("");
    try {
      const res = await clientApi<Paged<Listing>>(`/v1/listings?${query}&cursor=${encodeURIComponent(next)}`);
      setItems((xs) => {
        const known = new Set(xs.map((x) => x.id));
        return [...xs, ...res.items.filter((l) => !known.has(l.id))];
      });
      setNext(res.nextCursor);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {items.map((l) => <ListingCard key={l.id} listing={l} />)}
      {next || error ? (
        <div style={{ gridColumn: "1 / -1", textAlign: "center", marginTop: 4 }}>
          {next ? <button className="btn btn-o" onClick={load} disabled={busy}>{busy ? "Loading…" : "Show more listings"}</button> : null}
          {error ? <p className="error small" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
        </div>
      ) : null}
    </>
  );
}
