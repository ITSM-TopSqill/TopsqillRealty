import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { SettingsFrame } from "@/components/settings/SettingsFrame";
import { AlertSettings, type AlertSettingsData } from "@/components/settings/AlertSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alert settings" };

export default async function AlertsSettingsPage() {
  const [user, token] = await Promise.all([getUser(), getToken()]);
  if (!user || !token) redirect("/signin?next=/settings/alerts");
  const data = await api<AlertSettingsData>("/v1/me/alert-settings", { token }).catch(() => null);
  return (
    <Shell user={user} current="/settings">
      <SettingsFrame current="/settings/alerts" title="Alerts" intro="Choose what reaches you by email and on your phone. Changes save as soon as you flip a switch.">
        {data ? <AlertSettings initial={data} /> : <div className="card pad small">Your alert settings couldn&apos;t be loaded. Please try again.</div>}
      </SettingsFrame>
    </Shell>
  );
}
