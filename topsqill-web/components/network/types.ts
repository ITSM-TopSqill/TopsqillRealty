import type { Media } from "@/lib/types";

export type NetPerson = {
  id: string; name: string; type: string; headline?: string | null; agency?: string | null; city?: string | null;
  kycVerified?: boolean; reraVerified?: boolean; avatar?: Media | null; avatarMediaId?: string | null;
  since?: string; mutual?: number; reason?: string; connectionCount?: number;
};
export type NetSummary = { connections: number; pending: number; sent: number; dealers: number; builders: number; buyers: number; sellers: number };
export type NetPage = { items: NetPerson[]; total?: number; nextOffset: number | null };
