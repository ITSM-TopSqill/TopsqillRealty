import Link from "next/link";
import { Unsubscribe } from "@/components/settings/Unsubscribe";

export const metadata = { title: "Unsubscribe", robots: { index: false } };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  all: "all alert emails", message: "emails about new messages", connection: "emails about invitations", lead: "emails about new leads",
  match: "emails about matches", comment: "emails about comments and likes", post: "emails about network updates", job: "emails about jobs",
  listing: "emails about listing reviews", campaign: "emails about ad campaigns",
};

/**
 * Opened from "Stop these emails" in an alert email. It asks for one click
 * rather than unsubscribing on load, so a mail scanner that opens links
 * can't switch emails off by itself.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { u, k, t } = await searchParams;
  const valid = !!(u && k && t && LABEL[k]);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(460px, 100%)" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="logo-mark">t</span>
          <span className="logo-word">Topsqill.ai</span>
        </div>
        {valid ? (
          <Unsubscribe u={u!} k={k!} t={t!} label={LABEL[k!]} />
        ) : (
          <>
            <h1 style={{ fontSize: 22, marginBottom: 6 }}>This link isn&apos;t complete</h1>
            <p className="muted small">Open the link from the email again, or choose your emails in <Link href="/settings/alerts">Settings</Link>.</p>
          </>
        )}
      </div>
    </main>
  );
}
