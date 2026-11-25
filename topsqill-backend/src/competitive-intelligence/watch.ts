import { createHash } from "node:crypto";
import type { AdLibraryResult } from "./ad-library";

/**
 * Ad Library search results carry no stable ad id, so "is this the same ad
 * as last time" is approximated from its own real content (advertiser +
 * headline + the start of the body). Stable across repeated checks of the
 * same still-running ad; a real edit to the ad's text will register as a
 * "new" one - an acceptable, honestly-labelled limitation, not a fabricated
 * identity match.
 */
export function fingerprintAd(ad: Pick<AdLibraryResult, "pageName" | "headline" | "body">): string {
  const key = `${ad.pageName}|${ad.headline ?? ""}|${(ad.body ?? "").slice(0, 200)}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}
