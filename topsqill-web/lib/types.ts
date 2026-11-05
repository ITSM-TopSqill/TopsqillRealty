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
};

export type Paged<T> = { items: T[]; nextCursor: string | null };

export type Post = {
  id: string; authorId: string; kind: string; body: string; refId?: string | null;
  likeCount: number; commentCount: number; repostCount: number; createdAt: string;
  author?: PersonCard | null; media?: Media[]; likedByMe?: boolean;
};

export type Requirement = {
  id: string; purpose: "sale" | "rent"; kind: string; bhk?: number | null;
  city: string; localities: string[]; minPrice?: number | null; maxPrice?: number | null;
  timeline?: string | null; needsLoan?: boolean; matchCount: number; createdAt: string;
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
};

export type Notification = {
  id: string; kind: string; title: string; body?: string | null;
  targetType?: string | null; targetId?: string | null; readAt?: string | null; createdAt: string;
};
