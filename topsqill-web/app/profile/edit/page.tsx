import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { EditProfileForm } from "@/components/EditProfileForm";

export const metadata = { title: "Edit profile" };
export const dynamic = "force-dynamic";

export default async function EditProfilePage() {
  const user = await getUser();
  if (!user) redirect("/signin");
  return (
    <Shell user={user} current="/profile">
      <h1 style={{ fontSize: 26, marginBottom: 14 }}>Edit profile</h1>
      <EditProfileForm user={user} />
    </Shell>
  );
}
