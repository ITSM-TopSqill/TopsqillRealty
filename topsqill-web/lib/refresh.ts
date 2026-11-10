"use server";

import { revalidatePath } from "next/cache";

/**
 * After a member edits something, the public pages that show it are rebuilt
 * now instead of up to a minute later, so they see their change straight away.
 * Only these pages can be refreshed; anything else is ignored.
 */
const ALLOWED = /^\/(listings|jobs|requirements|profile|posts)(\/[A-Za-z0-9-]+)?$/;

export async function refreshPages(paths: string[]) {
  for (const p of paths.slice(0, 10)) if (ALLOWED.test(p)) revalidatePath(p);
  revalidatePath("/");
}
