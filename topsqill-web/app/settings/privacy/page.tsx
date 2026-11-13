import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { SettingsFrame } from "@/components/settings/SettingsFrame";
import { BlockedList, type BlockedPerson } from "@/components/settings/BlockedList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy and blocking" };

export default async function PrivacySettingsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user || !token) redirect("/signin?next=/settings/privacy");
  const blocked = await api<{ items: BlockedPerson[] }>("/v1/me/blocked", { token }).catch(() => ({ items: [] as BlockedPerson[] }));
  return (
    <Shell user={user} current="/settings">
      <SettingsFrame current="/settings/privacy" title="Privacy & blocking">
        <div className="card pad" style={{ marginBottom: 14 }}>
          <b>Who sees what</b>
          <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--ink2)", display: "flex", flexDirection: "column", gap: 4 }}>
            <li>Your profile, listings and posts can be seen by anyone on Topsqill.ai.</li>
            <li>Your phone number and email are shown only to your connections.</li>
            <li>Someone you block can&apos;t see your profile or posts, message you or invite you. They aren&apos;t told.</li>
          </ul>
        </div>
        <h3 style={{ fontSize: 17, margin: "0 0 8px" }}>Blocked members {blocked.items.length ? <span className="muted">({blocked.items.length})</span> : null}</h3>
        <BlockedList initial={blocked.items} />
        <p className="small muted" style={{ marginTop: 12 }}>Seen something that breaks the rules? Use ⚑ Report on the post, listing or profile, and our team will review it.</p>
      </SettingsFrame>
    </Shell>
  );
}
