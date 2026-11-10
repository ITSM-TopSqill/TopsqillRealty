import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Assistant } from "@/components/Assistant";

export const metadata = { title: "Ask Topsqill.ai" };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await getUser();
  if (!user) redirect("/signin?next=/assistant");
  return (
    <Shell user={user} current="/assistant">
      <Assistant firstName={user.name.split(" ")[0]} />
    </Shell>
  );
}
