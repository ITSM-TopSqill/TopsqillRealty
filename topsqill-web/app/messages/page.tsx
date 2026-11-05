import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getUser, getToken } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { Messenger } from "@/components/Messenger";
import type { Conversation, Paged, Message } from "@/lib/types";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const [{ c }, user, token] = await Promise.all([searchParams, getUser(), getToken()]);
  if (!user) redirect("/signin");

  const inbox = await api<{ items: Conversation[] }>("/v1/conversations", { token }).catch(() => ({ items: [] }));
  const activeId = c ?? inbox.items[0]?.id ?? null;
  const history = activeId
    ? await api<Paged<Message>>(`/v1/conversations/${activeId}/messages?limit=40`, { token }).catch(() => ({ items: [], nextCursor: null }))
    : { items: [], nextCursor: null };

  const unread = inbox.items.reduce((n, x) => n + (x.unread ?? 0), 0);
  return (
    <Shell user={user} current="/messages" unread={{ messages: unread }}>
      <Messenger me={user.id} conversations={inbox.items} activeId={activeId} initialMessages={history.items.slice().reverse()} />
    </Shell>
  );
}
