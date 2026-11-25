import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { NewBusiness } from "@/components/NewBusiness";

export const metadata = { title: "New business" };
export const dynamic = "force-dynamic";

export default async function NewBusinessPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/business/new");

  return (
    <Shell user={user} current="/leads">
      <Link href="/business" className="small muted">← Businesses</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Set up a business</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        For anything other than real estate. Describe the business in plain words, or fill in the form yourself - either way, you review and fix it before anything is saved.
      </p>
      <NewBusiness />
    </Shell>
  );
}
