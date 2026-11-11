import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ImportProject } from "@/components/ImportProject";

export const metadata = { title: "Import a project" };
export const dynamic = "force-dynamic";

export default async function ImportProjectPage({ searchParams }: { searchParams: Promise<{ url?: string }> }) {
  const [user, { url }] = await Promise.all([getUser(), searchParams]);
  if (!user) redirect("/signin?next=/projects/new");
  return (
    <Shell user={user} current="/listings">
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Import a project</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Paste the link to the builder’s project page (or its brochure text). AI pulls out the configurations, prices, amenities and
        nearby places, checks the price against the locality and builds a full project page. You review it before anything goes live.
      </p>
      <ImportProject initialUrl={typeof url === "string" && /^https?:\/\//.test(url) ? url : ""} />
    </Shell>
  );
}
