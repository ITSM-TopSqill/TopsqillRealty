"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { clientApi } from "@/lib/api";

/**
 * Contacting the seller opens a real conversation and, on the seller's side,
 * creates a lead in their CRM. One tap, both things.
 */
export function ContactOwner({ listingId, ownerId, signedIn, title }: {
  listingId: string; ownerId: string; signedIn: boolean; title: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!signedIn) {
    return <Link href={`/signin?next=/listings/${listingId}`} className="btn btn-ai">Sign in to contact</Link>;
  }

  async function contact() {
    setBusy(true); setError("");
    try {
      const convo = await clientApi<{ id: string }>(`/v1/conversations/with/${ownerId}`, { method: "POST" });
      await clientApi(`/v1/conversations/${convo.id}/messages`, {
        method: "POST",
        body: { body: `Hi, I’m interested in ${title}. Is it still available? I’d like to arrange a site visit.`, refType: "listing", refId: listingId },
      });
      router.push(`/messages?c=${convo.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div style={{ textAlign: "right" }}>
      <button className="btn btn-ai" onClick={contact} disabled={busy}>
        {busy ? "Opening chat…" : "💬 Contact seller"}
      </button>
      {error ? <p className="error" style={{ marginTop: 6 }}>{error}</p> : null}
    </div>
  );
}
