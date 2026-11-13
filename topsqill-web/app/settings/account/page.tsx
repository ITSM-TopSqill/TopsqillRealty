import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { SettingsFrame } from "@/components/settings/SettingsFrame";
import { DeleteAccount, type DeletionCheck } from "@/components/settings/DeleteAccount";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account settings" };

type Me = { id: string; name: string; contact?: { phone?: string; email?: string } | null; createdAt?: string };

export default async function AccountSettingsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user || !token) redirect("/signin?next=/settings/account");
  const [me, check] = await Promise.all([
    api<Me>("/v1/me", { token }).catch(() => null),
    api<DeletionCheck>("/v1/me/deletion", { token }).catch(() => null),
  ]);
  const since = me?.createdAt ? new Date(me.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : null;
  return (
    <Shell user={user} current="/settings">
      <SettingsFrame current="/settings/account" title="Account">
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          {[
            ["Name", me?.name ?? user.name, <Link key="e" href="/profile/edit" className="btn btn-g sm">Edit</Link>],
            ["Mobile number", me?.contact?.phone || "Not added", null],
            ["Email", me?.contact?.email || "Not added", <Link key="m" href="/profile/edit" className="btn btn-g sm">{me?.contact?.email ? "Change" : "Add"}</Link>],
            ["Member since", since ?? "—", null],
          ].map(([label, value, action], i) => (
            <div key={String(label)} className="row" style={{ gap: 12, padding: "12px 16px", borderTop: i ? "1px solid var(--line)" : 0 }}>
              <span className="small muted" style={{ width: 130, flex: "0 0 auto", fontWeight: 700 }}>{label as string}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{value as string}</span>
              {action}
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: "0 0 18px" }}>You sign in with a one-time code sent to your mobile number or email, so there&apos;s no password to manage.</p>
        {check ? <DeleteAccount check={check} /> : <div className="card pad small">Account details couldn&apos;t be loaded. Please try again.</div>}
      </SettingsFrame>
    </Shell>
  );
}
