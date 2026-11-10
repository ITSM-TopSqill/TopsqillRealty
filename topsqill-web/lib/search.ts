/** Shapes returned by GET /v1/search. */
import type { Media } from "./types";

export type SearchPerson = { id: string; name: string; type: string; headline?: string | null; city?: string | null; agency?: string | null; kycVerified?: boolean; reraVerified?: boolean };
export type SearchListing = { id: string; title: string; priceInr?: number | null; purpose: "sale" | "rent"; kind: string; bhk?: number | null; areaSqft?: number | null; city: string; locality: string; possession?: string | null; verified?: boolean; publishedAt?: string | null; cover?: Pick<Media, "urls"> | null };
export type SearchLocality = { locality: string; city: string; listings: number; avgRate?: number | null };
export type SearchJob = { id: string; title: string; company: string; city: string; locality?: string | null; category: string; salaryMin?: string | null; salaryMax?: string | null };
export type SearchResults = { people: SearchPerson[]; listings: SearchListing[]; localities: SearchLocality[]; jobs: SearchJob[] };
export const EMPTY: SearchResults = { people: [], listings: [], localities: [], jobs: [] };
