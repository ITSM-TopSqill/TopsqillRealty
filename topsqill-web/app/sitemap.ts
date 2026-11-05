import type { MetadataRoute } from "next";
import { api } from "@/lib/api";
import type { Listing, Job, Paged } from "@/lib/types";

/** Listings and jobs are public, so they belong in the sitemap for search engines. */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://topsqill.ai";
  const [listings, jobs] = await Promise.all([
    api<Paged<Listing>>("/v1/listings?limit=50", { revalidate: 3600 }).catch(() => ({ items: [], nextCursor: null })),
    api<Paged<Job>>("/v1/jobs?limit=50", { revalidate: 3600 }).catch(() => ({ items: [], nextCursor: null })),
  ]);

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/listings`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/requirements`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/jobs`, changeFrequency: "daily", priority: 0.7 },
    ...listings.items.map((l) => ({
      url: `${base}/listings/${l.id}`,
      lastModified: l.publishedAt ? new Date(l.publishedAt) : undefined,
      changeFrequency: "weekly" as const, priority: 0.8,
    })),
    ...jobs.items.map((j) => ({
      url: `${base}/jobs/${j.id}`,
      lastModified: new Date(j.createdAt),
      changeFrequency: "weekly" as const, priority: 0.6,
    })),
  ];
}
