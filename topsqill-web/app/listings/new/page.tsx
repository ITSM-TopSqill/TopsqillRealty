import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { NewListingForm } from "@/components/NewListingForm";

export const metadata = { title: "Add a listing" };
export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const user = await getUser();
  if (!user) redirect("/signin");
  return (
    <Shell user={user} current="/listings">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Add a listing</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>
        Describe the property in one line and let AI fill in the rest, or type the details yourself.
      </p>
      <NewListingForm defaultCity={user.city ?? "Gurgaon"} />
    </Shell>
  );
}
