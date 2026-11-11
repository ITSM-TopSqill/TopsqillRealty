import { createHash } from "node:crypto";
import { Logger } from "@nestjs/common";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import { env } from "../common/env";

/**
 * The guided video's presenter: a natural Indian English voice from Google
 * Cloud Text-to-Speech. Each line becomes an MP3 in the public bucket, named
 * by a hash of the voice and the words, so a line is only ever made once and
 * is served from the CDN after that. Without Google Cloud (local runs), there
 * is no audio and the browser's own voice is used instead.
 */
const log = new Logger("voice");
let client: TextToSpeechClient | null = null;
const FALLBACK_VOICES = ["en-IN-Neural2-D", "en-IN-Wavenet-D", "en-IN-Standard-D"];

/** How a presenter would say it: "₹1.82 Cr" → "1.82 crore rupees", "3 BHK" → "3 B H K". */
export function speakable(text: string) {
  return text
    .replace(/₹\s?([\d.,]+)\s?(Cr|crore)\b\.?/gi, "$1 crore rupees")
    .replace(/₹\s?([\d.,]+)\s?(L|lakh|lac)\b\.?/gi, "$1 lakh rupees")
    .replace(/₹\s?([\d,]+)(\/month| a month)?/gi, (_m, n: string, pm?: string) => `${n} rupees${pm ? " a month" : ""}`)
    .replace(/\b(\d+)\s?BHK\b/gi, "$1 B H K")
    .replace(/\bsq\.?\s?ft\b/gi, "square feet")
    .replace(/\bRERA\b/g, "Rera")
    .replace(/\s+/g, " ")
    .trim();
}

export function voiceKey(voice: string, text: string) {
  return `public/voice/${createHash("sha1").update(`${voice}|${text}`).digest("hex").slice(0, 24)}.mp3`;
}

/** The public link to this line spoken aloud, making it the first time. Null when it can't be made. */
export async function speak(text: string): Promise<string | null> {
  const words = speakable(text);
  if (!words || !env.GCP_PROJECT_ID) return null;
  // Loaded only when needed: storage reads the cloud settings when it loads.
  const { onCloud, publicBase, publicExists, writePublic } = await import("../media/storage");
  if (!onCloud()) return null;
  const voices = [env.TTS_VOICE, ...FALLBACK_VOICES.filter((v) => v !== env.TTS_VOICE)];
  for (const voice of voices) {
    const path = voiceKey(voice, words);
    try {
      if (await publicExists(path)) return `${publicBase()}/${path}`;
      client ??= new TextToSpeechClient();
      const [res] = await client.synthesizeSpeech({
        input: { text: words },
        voice: { languageCode: voice.slice(0, 5), name: voice },
        audioConfig: { audioEncoding: "MP3", speakingRate: 0.97, pitch: 0, effectsProfileId: ["headphone-class-device"] },
      });
      if (!res.audioContent) return null;
      await writePublic(path, Buffer.from(res.audioContent as Uint8Array), "audio/mpeg");
      return `${publicBase()}/${path}`;
    } catch (e) {
      const msg = (e as Error).message;
      // An unknown voice name tries the next voice; anything else (API off, no permission) stops.
      if (/voice|invalid/i.test(msg) && !/permission|disabled|not been used/i.test(msg)) continue;
      log.warn(`voice-over unavailable: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}

/** Speaks several lines, a few at a time. Returns { line: link } for those that worked. */
export async function speakAll(lines: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(lines.map((l) => l.trim()).filter(Boolean))].slice(0, 40);
  const out: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const urls = await Promise.all(batch.map((l) => speak(l).catch(() => null)));
    batch.forEach((l, n) => { if (urls[n]) out[l] = urls[n]!; });
    if (i === 0 && !Object.keys(out).length) break;   // voice-overs aren't available: don't keep trying
  }
  return out;
}
