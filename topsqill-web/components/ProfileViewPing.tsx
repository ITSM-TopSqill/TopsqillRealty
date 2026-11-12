"use client";

import { useEffect } from "react";
import { clientApi } from "@/lib/api";

/** Counts this visit to someone's profile (once a day per viewer; never your own). */
export function ProfileViewPing({ id }: { id: string }) {
  useEffect(() => { clientApi(`/v1/profiles/${id}/view`, { method: "POST" }).catch(() => {}); }, [id]);
  return null;
}
