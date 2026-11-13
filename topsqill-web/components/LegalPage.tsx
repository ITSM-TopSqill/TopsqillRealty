import Link from "next/link";
import { getUser } from "@/lib/session";
import { Shell } from "./Shell";

/** Shared layout for the privacy policy and terms. */
export async function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const user = await getUser().catch(() => null);
  return (
    <Shell user={user} current="/">
      <article className="card pad legal" style={{ maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28 }}>{title}</h1>
        <p className="small muted">Last updated {updated}</p>
        {children}
        <p className="small muted" style={{ marginTop: 24 }}><Link href="/privacy">Privacy policy</Link> · <Link href="/terms">Terms, payments and refunds</Link></p>
      </article>
      <style>{`.legal h2{font-size:18px;margin:22px 0 6px}.legal p,.legal li{line-height:1.6}`}</style>
    </Shell>
  );
}
