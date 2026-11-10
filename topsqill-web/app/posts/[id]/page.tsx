import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { PostCard } from "@/components/Feed";
import type { Post } from "@/lib/types";

export const dynamic = "force-dynamic";

const load = (id: string, token: string | null) =>
  api<Post>(`/v1/posts/${id}`, token ? { token } : { revalidate: 30 }).catch(() => null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await load((await params).id, null);
  if (!p) return { title: "Post" };
  return { title: `${p.author?.name ?? "A member"} on Topsqill.ai`, description: p.body.slice(0, 160) };
}

/** One post on its own page: opened from shared links and alerts. */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, token] = await Promise.all([getUser(), getToken()]);
  const post = await load(id, token);
  if (!post) notFound();
  return (
    <Shell user={user} current="/">
      <div style={{ maxWidth: 640, margin: "0 auto" }} className="col">
        <Link href="/" className="small muted">← Home</Link>
        <PostCard post={post} meId={user?.id ?? null} startOpen />
      </div>
    </Shell>
  );
}
