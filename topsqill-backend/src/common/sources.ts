/**
 * Keeps other property sites' names and links out of what Topsqill publishes.
 *
 * An imported listing must read as the member's own: no "Posted on 99acres",
 * no portal links, no "MagicBricks verified". Only imports are cleaned; what
 * a member types themselves is left alone.
 */
const BRANDS = [
  "99\\s?acres(?:\\.com)?", "magic\\s?bricks(?:\\.com)?", "no\\s?broker(?:\\.(?:in|com))?", "housing\\.com",
  "square\\s?yards(?:\\.com)?", "common\\s?floor(?:\\.com)?", "prop\\s?tiger(?:\\.com)?", "makaan(?:\\.com)?",
  "nest\\s?away(?:\\.com)?", "quikr\\s?homes?", "olx", "sulekha(?:\\.com)?", "proptiger", "roof\\s?and\\s?floor", "zameen(?:\\.com)?",
].join("|");

/** Hosts whose photos are usually stamped with the site's own watermark. */
export const PORTAL_HOST = /(^|\.)(99acres|magicbricks|nobroker|housing|squareyards|commonfloor|proptiger|makaan|nestaway|quikr|olx|sulekha|roofandfloor)\./i;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
// "posted on 99acres", "as listed on MagicBricks", "via NoBroker", "99acres verified", "(99acres)"
const PHRASE = new RegExp(`(?:\\b(?:as\\s+)?(?:posted|listed|advertised|available|seen|found|shown|verified|featured|exclusive)\\s+)?(?:\\b(?:on|at|via|from|by|in)\\s+)?(?<![\\w.])(?:${BRANDS})(?![\\w])(?:\\s+(?:verified|exclusive|listing|property|ad|id|code)\\b)?(?:\\s*(?:id|code)?\\s*[:#]?\\s*[A-Z]{0,3}\\d{5,})?`, "gi");

export function scrubSources(s: string): string {
  if (!s) return s;
  return s
    .replace(URL_RE, "")
    .replace(PHRASE, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([.,;:!?])(?:\s*[.,;:!?])+/g, "$1")
    .replace(/^[\s,;:|·–-]+|[\s,;:|·–-]+$/gm, "")
    .trim();
}

/** Cleans a list, dropping items that were nothing but a site's name. */
export function scrubList(xs: string[]): string[] {
  return xs.map(scrubSources).filter((x) => x.length > 1);
}
