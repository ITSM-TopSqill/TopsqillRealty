/**
 * The only way this app talks to the backend.
 *
 * Tokens live in httpOnly cookies that JavaScript cannot read, so a cross-site
 * script cannot steal a session. Browser requests go to this app's own /api
 * routes, which attach the token server-side and forward to the API.
 */
export type ApiError = { statusCode: number; message: string | string[] };

export class ApiException extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiException";
  }
}

export const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** Seconds the result may be reused. Used for public pages. */
  revalidate?: number;
  signal?: AbortSignal;
};

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    if (body?.message) return Array.isArray(body.message) ? body.message[0] : body.message;
  } catch {
    /* fall through to the friendly default */
  }
  return "Something went wrong. Please try again.";
}

/** Server-side call to the API. Used by pages, layouts and route handlers. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
    ...(opts.revalidate !== undefined ? { next: { revalidate: opts.revalidate } } : { cache: "no-store" }),
  });
  if (!res.ok) throw new ApiException(res.status, await readError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Browser-side call, through this app's own proxy so the token stays hidden. */
export async function clientApi<T>(path: string, opts: Omit<Options, "token" | "revalidate"> = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    method: opts.method ?? "GET",
    headers: opts.body === undefined ? {} : { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (!res.ok) throw new ApiException(res.status, await readError(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
