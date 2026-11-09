import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { getAuthMethods, safeNext } from "@/lib/auth-methods";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (await getUser()) redirect(next ?? "/");
  const methods = await getAuthMethods();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(440px, 100%)" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="logo-mark">t</span>
          <span className="logo-word">Topsqill.ai</span>
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Welcome back</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          Sign in with a one-time code. No password to remember.
        </p>
        <AuthForm mode="signin" methods={methods} next={next} />
      </div>
    </main>
  );
}
