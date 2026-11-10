import { notFound, redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { NewListingForm } from "@/components/NewListingForm";
import type { Listing } from "@/lib/types";

export const metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, token] = await Promise.all([params, getUser(), getToken()]);
  if (!user) redirect(`/signin?next=/listings/${id}/edit`);
  // The API only returns it to the owner.
  const listing = await api<Listing>(`/v1/listings/${id}/edit`, { token }).catch(() => null);
  if (!listing) notFound();
  return (
    <Shell user={user} current="/listings">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Edit listing</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Change anything, including the photos. The first photo is the cover. Buyers looking for something like this are matched again when you save.
      </p>
      <NewListingForm defaultCity={user.city ?? "Gurgaon"} listing={listing} />
    </Shell>
  );
}
