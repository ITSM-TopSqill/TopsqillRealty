import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { OnboardingForm } from "@/components/OnboardingForm";

export const metadata = { title: "Create your profile" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/signin");
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="card pad" style={{ width: "min(560px, 100%)" }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="logo-mark">t</span><span className="logo-word">Topsqill.ai</span>
        </div>
        <h1 style={{ fontSize: 26 }}>Welcome to Topsqill.ai</h1>
        <p className="muted" style={{ margin: "6px 0 18px" }}>
          Tell us who you are. AI will write your headline and About, and you can edit both.
        </p>
        <OnboardingForm name={user.name} />
      </div>
    </main>
  );
}
