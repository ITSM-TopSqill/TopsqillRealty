import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await getUser()) redirect("/");
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(420px, 100%)" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="logo-mark">t</span>
          <span className="logo-word">Topsqill.ai</span>
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Sign in</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          We’ll send a one-time code to your mobile number. No password to remember.
        </p>
        <SignInForm />
      </div>
    </main>
  );
}
