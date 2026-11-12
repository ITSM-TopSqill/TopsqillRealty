import { Logger } from "@nestjs/common";
import { env } from "./env";

/**
 * Indian English speech from Google Cloud Text-to-Speech, for the campaign
 * podcast. Two voices (a woman and a man) so the two hosts sound different.
 * Returns MP3 bytes, or null where Text-to-Speech isn't available (local
 * runs, or the API switched off): the website then reads the script with the
 * browser's own voice instead.
 */
const log = new Logger("tts");
let client: import("@google-cloud/text-to-speech").TextToSpeechClient | null | undefined;
export const VOICES = {
  female: ["en-IN-Neural2-A", "en-IN-Wavenet-A", "en-IN-Standard-A"],
  male: ["en-IN-Neural2-B", "en-IN-Wavenet-B", "en-IN-Standard-B"],
} as const;

/** How a presenter would say it: "₹1.82 Cr" → "1.82 crore rupees", "3 BHK" → "3 B H K". */
export function speakable(text: string) {
  return text
    .replace(/₹\s?([\d.,]+)\s?(Cr|crore)\b\.?/gi, "$1 crore rupees")
    .replace(/₹\s?([\d.,]+)\s?(L|lakh|lac)\b\.?/gi, "$1 lakh rupees")
    .replace(/₹\s?([\d,]+)(\/month| a month)?/gi, (_m, n: string, pm?: string) => `${n} rupees${pm ? " a month" : ""}`)
    .replace(/\b(\d+)\s?BHK\b/gi, "$1 B H K")
    .replace(/\bsq\.?\s?ft\b/gi, "square feet")
    .replace(/\s+/g, " ")
    .trim();
}

export async function speakMp3(text: string, voice: keyof typeof VOICES): Promise<Buffer | null> {
  if (!env.GCP_PROJECT_ID) return null;
  if (client === undefined) {
    const mod = await import("@google-cloud/text-to-speech").catch(() => null);
    client = mod ? new mod.TextToSpeechClient() : null;
  }
  if (!client) return null;
  for (const name of VOICES[voice]) {
    try {
      const [res] = await client.synthesizeSpeech({
        input: { text: speakable(text) },
        voice: { languageCode: "en-IN", name },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, sampleRateHertz: 24000 },
      });
      if (res.audioContent) return Buffer.from(res.audioContent as Uint8Array);
    } catch (e) {
      const msg = (e as Error).message;
      if (/voice|invalid/i.test(msg) && !/permission|disabled|not been used/i.test(msg)) continue;   // try the next voice
      log.warn(`text-to-speech unavailable: ${msg.slice(0, 160)}`);
      return null;
    }
  }
  return null;
}
