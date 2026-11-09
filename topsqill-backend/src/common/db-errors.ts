/**
 * Drizzle wraps database errors, so the Postgres code sits on `cause`.
 * 23505 is a unique-constraint violation: the row already exists.
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const err = cur as { code?: string; message?: string; cause?: unknown };
    if (err.code === "23505" || /duplicate key value/i.test(err.message ?? "")) return true;
    cur = err.cause;
  }
  return false;
}
