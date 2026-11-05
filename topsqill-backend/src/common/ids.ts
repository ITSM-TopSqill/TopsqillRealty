import { v7 as uuidv7 } from "uuid";

/**
 * UUIDv7 is time-ordered: new rows are written next to each other in the index
 * instead of scattered across it. On a large table this keeps inserts fast and
 * keeps "newest first" queries reading a small, contiguous part of the index.
 */
export const newId = (): string => uuidv7();

export type Cursor = { t: string; id: string };

/** Keyset pagination: "give me what comes after this exact row", which stays fast at any depth. */
export const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

export const decodeCursor = (raw?: string | null): Cursor | null => {
  if (!raw) return null;
  try {
    const [t, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!t || !id || Number.isNaN(Date.parse(t))) return null;
    return { t, id };
  } catch { return null; }
};
