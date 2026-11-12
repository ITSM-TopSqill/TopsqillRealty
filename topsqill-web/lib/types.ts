/** Shapes returned by the Topsqill.ai API, kept in one place. */

export type Media = { id: string; kind: string; status: string; label?: string | null; urls?: Record<string, string>; blurhash?: string | null };

export type PersonCard = {
  id: string; name: string; type: string; headline?: string | null;
  city?: string | null; kycVerified?: boolean; reraVerified?: boolean; avatarMediaId?: string | null;
};

export type Listing = {
  id: string; title: string; purpose: "sale" | "rent"; kind: string;
  bhk?: number | null; areaSqft?: number | null; priceInr?: number | null;
  city: string; locality: string; possession?: string | null; furnishing?: string | null;
  facing?: string | null; description?: string | null; amenities?: string[]; usps?: string[];
  verified?: boolean; viewCount?: number; publishedAt?: string | null;
  coverMediaId?: string | null; cover?: Media | null; media?: Media[];
  owner?: PersonCard | null; ownerId?: string;
  projectSourceId?: string | null; reraNumber?: string | null;
  status?: "draft" | "pending" | "active" | "sold" | "archived";
  lat?: number | null; lng?: number | null; videoUrl?: string | null; tourUrl?: string | null; sourceUrl?: string | null;
  previousPriceInr?: number | null; priceDroppedAt?: string | null;
};

export type Paged<T> = { items: T[]; nextCursor: string | null };

export type Post = {
  id: string; authorId: string; kind: string; body: string; refId?: string | null;
  likeCount: number; commentCount: number; repostCount: number; createdAt: string;
  author?: PersonCard | null; media?: Media[]; likedByMe?: boolean;
  /** A repost carries the original post (null when the original was removed). */
  repostOfId?: string | null; repostOf?: Post | null;
};

export type Requirement = {
  id: string; purpose: "sale" | "rent"; kind: string; bhk?: number | null;
  city: string; localities: string[]; minPrice?: number | null; maxPrice?: number | null;
  timeline?: string | null; needsLoan?: boolean; matchCount: number; createdAt: string;
  minArea?: number | null; note?: string | null; status?: "active" | "matched" | "closed";
  userId?: string; userName?: string; userType?: string; userHeadline?: string | null;
};

export type Lead = {
  id: string; name: string; phone?: string | null; email?: string | null;
  stage: string; score: number; qualified: boolean; source: string;
  listingId?: string | null; listingTitle?: string | null; locality?: string | null;
  budgetMax?: number | null; note?: string | null; createdAt: string; lastActivityAt?: string | null;
  activities?: { id: string; kind: string; body?: string | null; createdAt: string }[];
};

export type Conversation = {
  id: string; peer: PersonCard | null; lastMessageAt?: string | null;
  lastMessagePreview?: string | null; lastSenderId?: string | null; unread: number;
};

export type Message = {
  id: string; conversationId: string; senderId: string; body?: string | null;
  mediaIds?: string[]; media?: Media[]; readAt?: string | null; createdAt: string;
};

export type Job = {
  id: string; title: string; company: string; category: string; city: string;
  locality?: string | null; employment: string; workMode: string; openings: number;
  expMin: number; expMax: number; salaryMin?: string | null; salaryMax?: string | null;
  incentives: boolean; skills: string[]; summary?: string | null;
  responsibilities: string[]; requirements: string[]; applicantCount: number; createdAt: string;
  ownerId?: string; status?: "draft" | "open" | "closed";
};

export type Notification = {
  id: string; kind: string; title: string; body?: string | null;
  targetType?: string | null; targetId?: string | null; readAt?: string | null; createdAt: string;
};

export type MyListing = {
  id: string; title: string; status: string; purpose: "sale" | "rent"; kind: string;
  bhk?: number | null; areaSqft?: number | null; priceInr?: number | null;
  city: string; locality: string; viewCount: number; leadCount: number;
  possession?: string | null; cover?: Media | null; ownerId?: string; publishedAt?: string | null;
};

export type CampaignPlan = {
  personas: { name: string; share: number; why: string; signals: string[] }[];
  pincodes: { pin: string; area: string; tier: string; reason: string }[];
  radiusKm: number; intentKeywords: string[]; negativeKeywords: string[]; exclusions: string[];
  languages: string[]; channels: { channel: string; budgetPct: number; format: string }[];
  schedule: string; qualification: { questions: string[]; otp: boolean; bot: boolean; minScore: number };
  compliance: string[];
};

export type CampaignCreatives = {
  headlines?: string[]; primaryTexts?: string[]; hinglish?: string;
  carousel?: { title: string; sub: string }[]; reel?: { caption: string; sub: string }[];
  googleAd?: { headlines: string[]; descriptions: string[] }; whatsappTemplate?: string;
};

export type Campaign = {
  id: string; name: string; goal: string; budgetInr: number; days: number; status: string;
  listingId?: string | null; plan?: CampaignPlan | null; creatives?: CampaignCreatives | null;
  forecast?: { reach: number; clicks: number; leads: number; qualified: number; qualifiedRatePct: number; costPerLead: number; costPerQualifiedLead: number } | null;
  spendInr: number; leadsCount: number; qualifiedCount: number; launchedAt?: string | null; createdAt: string;
};

export type Project = {
  id: string; ownerId: string; sourceUrl?: string | null; name: string; builder?: string | null;
  city: string; locality: string; reraNumber?: string | null; status: string; possession?: string | null;
  acres?: string | null; towers?: number | null; floors?: number | null; units?: number | null;
  openArea?: number | null; paymentPlan?: string | null; facing: string[]; amenities: string[]; specs: string[];
  configs: { bhk: number; sbua: number; carpet: number; price: number; estimated?: boolean }[];
  nearby: { name: string; km: number; icon: string }[]; usps: string[];
  summary?: string | null; verdict?: string | null;
  risk?: { score: number; level: string; factors: { label: string; level: string; note: string }[] } | null;
  priceEstimated: boolean; aiSource: string; published: boolean; createdAt: string;
};
