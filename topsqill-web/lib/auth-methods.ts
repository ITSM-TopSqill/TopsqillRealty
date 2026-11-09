import { api } from "./api";

export type AuthMethods = { phone: boolean; email: boolean };

/** Which ways of receiving a code work right now. Email is assumed if the API can't say. */
export async function getAuthMethods(): Promise<AuthMethods> {
  return api<AuthMethods>("/v1/auth/methods", { revalidate: 60 }).catch(() => ({ phone: false, email: true }));
}

/** Only same-site paths, so a crafted link can't send someone elsewhere after signing in. */
export function safeNext(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : null;
}
