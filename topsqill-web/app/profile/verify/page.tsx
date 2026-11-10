import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { VerifyForm, type Request } from "@/components/VerifyForm";

export const metadata = { title: "Get verified" };
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user) redirect("/signin?next=/profile/verify");
  const { items } = await api<{ items: Request[] }>("/v1/verifications/mine", { token }).catch(() => ({ items: [] as Request[] }));

  return (
    <Shell user={user} current="/profile">
      <Link href={`/profile/${user.id}`} className="small muted">← My profile</Link>
      <h1 style={{ fontSize: 26, margin: "6px 0" }}>Get verified</h1>
      <p className="muted small" style={{ marginBottom: 16, maxWidth: "70ch" }}>
        Verified members get a badge on their profile, listings and posts, and buyers trust them more.
        Your documents are stored privately, seen only by our review team, and never shown on Topsqill.ai.
      </p>
      <VerifyForm requests={items} kyc={!!user.kycVerified} rera={!!user.reraVerified} dealer={user.type === "dealer"} reraNumber={user.reraNumber ?? ""} />
    </Shell>
  );
}
