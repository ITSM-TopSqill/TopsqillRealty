import { randomInt } from "node:crypto";

/** Normalises Indian phone numbers to E.164 (+91XXXXXXXXXX). */
export function normalisePhone(raw: string, defaultCountry = "91"): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  d = d.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = defaultCountry + d;
  else if (d.length === 11 && d.startsWith("0")) d = defaultCountry + d.slice(1);
  if (d.startsWith("91") && d.length === 12) {
    if (!/^[6-9]/.test(d.slice(2))) return null;   // Indian mobiles start 6-9
    return "+" + d;
  }
  if (d.length >= 11 && d.length <= 15) return "+" + d;  // other countries, for NRI buyers
  return null;
}

/**
 * 6-digit code, never starting with 0 so it is easy to read out.
 * Drawn from the OS's cryptographic generator: Math.random is predictable.
 */
export function makeOtp(): string {
  return String(randomInt(100000, 1000000));
}
