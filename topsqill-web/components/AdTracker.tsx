"use client";

import { useEffect } from "react";

const KEY = (listingId: string) => `tsq-ad:${listingId}`;
const WEEK = 7 * 86_400_000;

/**
 * A visitor who arrives from one of the listing's ads (the link carries
 * ?ad=<campaign>) is remembered on this device for a week, so if they enquire
 * later the lead is credited to that campaign. Nothing personal is stored.
 */
export function AdTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    try {
      const ad = new URLSearchParams(window.location.search).get("ad");
      if (ad && /^[\w-]{8,40}$/.test(ad)) localStorage.setItem(KEY(listingId), JSON.stringify({ ad, at: Date.now() }));
    } catch { /* storage blocked: nothing to remember */ }
  }, [listingId]);
  return null;
}

/** The campaign that brought this visitor to the listing, if it was within the last week. */
export function adFor(listingId: string): string | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(listingId)) ?? "null") as { ad: string; at: number } | null;
    return v && Date.now() - v.at < WEEK ? v.ad : undefined;
  } catch { return undefined; }
}
