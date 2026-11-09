import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { getAuthMethods } from "@/lib/auth-methods";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "Create your account" };
export const dynamic = "force-dynamic";

export default async function SignUpPage() {
  if (await getUser()) redirect("/");
  const methods = await getAuthMethods();
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(480px, 100%)" }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="logo-mark">t</span>
          <span className="logo-word">Topsqill.ai</span>
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Join Topsqill.ai</h1>
        <p className="muted small" style={{ marginBottom: 18 }}>
          Create your free account. We’ll send a code to confirm it’s you, then help you set up your profile.
        </p>
        <AuthForm mode="signup" methods={methods} next={null} />
      </div>
    </main>
  );
}
