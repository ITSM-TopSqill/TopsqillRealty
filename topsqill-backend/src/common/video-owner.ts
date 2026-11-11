import { BadRequestException } from "@nestjs/common";
import { safeFetch } from "./safe-fetch";

/** Property portals' own channels. Their videos carry the portal's name and belong to it. */
const PORTAL_CHANNEL = /99[\s_-]?acres|magic[\s_-]?bricks|no[\s_-]?broker|housing(\.|[\s_-]?dot[\s_-]?)?com|square[\s_-]?yards|common[\s_-]?floor|prop[\s_-]?tiger|makaan|nest[\s_-]?away|quikr|sulekha|roof[\s_-]?and[\s_-]?floor/i;

/** Asks YouTube or Vimeo whose video this is (their public oEmbed), and returns the channel's name and link. */
export async function videoChannel(url: string, fetchImpl: typeof safeFetch = safeFetch): Promise<{ name: string; url: string } | null> {
  const api = /vimeo\.com/i.test(url)
    ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
    : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  try {
    const res = await fetchImpl(api, { timeoutMs: 6000, accept: "application/json", maxBytes: 200_000 });
    const j = JSON.parse(String(res.body)) as { author_name?: string; author_url?: string };
    return { name: j.author_name ?? "", url: j.author_url ?? "" };
  } catch { return null; }
}

/**
 * Refuses a video from a property portal's channel: it shows the portal's name
 * on Topsqill and isn't the member's to publish. If YouTube or Vimeo can't be
 * asked, the link is allowed (the member has confirmed it is theirs).
 */
export async function assertOwnVideo(url: string | null | undefined, fetchImpl?: typeof safeFetch) {
  if (!url) return;
  const ch = await videoChannel(url, fetchImpl);
  if (ch && (PORTAL_CHANNEL.test(ch.name) || PORTAL_CHANNEL.test(ch.url))) {
    throw new BadRequestException(`That video is from ${ch.name}'s channel, so it can't be shown on Topsqill. Upload your own walkthrough video instead: we turn it into a guided video with captions and a voice-over.`);
  }
}
