import { ForbiddenException } from "@nestjs/common";
import { and, eq, or, sql, type SQL, type AnyColumn } from "drizzle-orm";
import type { Database } from "../db/db.module";
import { userBlocks } from "../db/schema";

/**
 * Blocking works both ways: once either member blocks the other, neither can
 * message, invite or see the other's posts. Plain functions, so any service
 * can check without a module dependency.
 */
export async function blockBetween(db: Database, a: string, b: string) {
  const rows = await db.select({ blockerId: userBlocks.blockerId }).from(userBlocks)
    .where(or(and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)), and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))))
    .limit(2);
  return { iBlocked: rows.some((r) => r.blockerId === a), theyBlocked: rows.some((r) => r.blockerId === b) };
}

/** Refuses an action between two members when either blocked the other. */
export async function assertNotBlocked(db: Database, me: string, other: string, action = "contact this member") {
  const { iBlocked, theyBlocked } = await blockBetween(db, me, other);
  if (iBlocked) throw new ForbiddenException(`You blocked this member. Unblock them first to ${action}.`);
  if (theyBlocked) throw new ForbiddenException(`You can’t ${action}.`);
}

/** A SQL condition: the member in `col` and the viewer have not blocked each other. */
export function notBlockedWith(viewerId: string, col: AnyColumn | SQL): SQL {
  return sql`not exists (select 1 from user_blocks ub where (ub.blocker_id = ${viewerId} and ub.blocked_id = ${col}) or (ub.blocker_id = ${col} and ub.blocked_id = ${viewerId}))`;
}
