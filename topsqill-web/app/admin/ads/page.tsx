import { api, API_URL } from "@/lib/api";
import { getToken } from "@/lib/session";
import { AdsSettingsForm, type AdsAdmin } from "@/components/admin/AdsSettingsForm";
import { WalletAdmin } from "@/components/admin/WalletAdmin";

export const metadata = { title: "Ads & wallets" };

/** Topsqill's ad accounts, payments, fee and invoice details; members' wallets. */
export default async function AdsAdminPage() {
  const token = await getToken();
  const [cfg, wallets] = await Promise.all([
    api<AdsAdmin>("/v1/admin/ads/settings", { token }).catch(() => null),
    api<{ totals: { balancePaise: number; heldPaise: number }; items: never[] }>("/v1/admin/wallets", { token }).catch(() => null),
  ]);
  const apiBase = (process.env.API_PUBLIC_URL ?? API_URL).replace(/\/$/, "");
  return (
    <>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>Ads &amp; wallets</h1>
      <p className="muted small" style={{ marginBottom: 16 }}>Members&apos; campaigns run on these accounts and are paid from their wallets. Keys and tokens live in Secret Manager, never here.</p>
      {cfg ? <AdsSettingsForm initial={cfg} apiBase={apiBase} /> : <p className="error">Couldn&apos;t load the settings.</p>}
      {wallets ? <WalletAdmin initial={wallets} /> : null}
    </>
  );
}
