import { redirect } from "next/navigation";
import { DemoButton } from "@/components/DemoButton";
import { getUser } from "@/lib/session";
import { getAuthMethods, safeNext } from "@/lib/auth-methods";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const deleted = params.deleted === "1";
  if (await getUser()) redirect(next ?? "/");
  const methods = await getAuthMethods();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(440px, 100%)" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="logo-mark">t</span>
          <span className="logo-word">Topsqill.ai</span>
        </div>
        {deleted ? (
          <p role="status" className="small" style={{ background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", marginBottom: 14 }}>
            Your account has been deleted. Thank you for being part of Topsqill.ai.
          </p>
        ) : null}
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Welcome back</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          Sign in with a one-time code. No password to remember.
        </p>
        <AuthForm mode="signin" methods={methods} next={next} />
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 14, textAlign: "center" }}>
          <p className="small muted" style={{ margin: "0 0 8px" }}>Just looking? Try Topsqill.ai as a demo dealer, no sign-up needed.</p>
          <DemoButton />
        </div>
      </div>
    </main>
  );
}
