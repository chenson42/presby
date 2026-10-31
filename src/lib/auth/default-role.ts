import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { roles, userRoles } from "@/lib/db/schema";
import { ADMIN_ROLE, MEMBER_ROLE } from "@/lib/permissions";
import { requireTwoFactorForPlatformRole } from "@/lib/auth/platform-role-two-factor";

/**
 * Bind a freshly-signed-in user to a default role if they have none.
 *
 * Moved out of `src/auth.ts` (F343, P3-4) so the admin branch and the "never
 * auth()" rule are testable without driving the NextAuth handlers;
 * `src/auth.ts` keeps parsing `INITIAL_ADMIN_EMAILS` and passes it in.
 *
 * Two reasons we do this at sign-in rather than relying on `events.createUser`:
 *
 *   1. `events.createUser` is fire-and-forget - the JWT callback can run
 *      before its async role insert completes, leaving the user with an
 *      empty `roles` array on first request.
 *   2. Credentials users skip the adapter entirely, so `events.createUser`
 *      never fires for them at all (this is why the seed script binds the
 *      local admin's role directly).
 *
 * Idempotent: returns early if the user already holds at least one role - which
 * also means a first administrator whose own two-factor setting an operator
 * later switched off is not switched back on at the next sign-in (E12).
 *
 * The grant and the person's own two-factor setting are written in ONE
 * transaction (DECISION-291): for an `INITIAL_ADMIN_EMAILS` address the helper
 * sets `users.two_factor_required` and audits it, and it runs only when the
 * `user_roles` row was newly inserted (`returning`), so a race with
 * `onConflictDoNothing` cannot double-audit. The `member` branch calls the same
 * helper, which writes nothing (the predicate says no): one code path, not an
 * `if (admin)`.
 *
 * The actor is an explicit `null` (a system write). This runs INSIDE the jwt
 * callback, so it must never call `auth()` or `recordAudit()` (which resolves an
 * omitted actor through `auth()`); a source-scan test pins that. The first token
 * is correct because this runs before the `dbUser` read in the same callback.
 */
export async function ensureDefaultRole(
  userId: string,
  email: string | null,
  initialAdminEmails: readonly string[],
): Promise<void> {
  const existing = await db.query.userRoles.findFirst({
    where: eq(userRoles.userId, userId),
  });
  if (existing) return;
  const desiredRoleName =
    email && initialAdminEmails.includes(email.toLowerCase()) ? ADMIN_ROLE : MEMBER_ROLE;
  const role = await db.query.roles.findFirst({
    where: eq(roles.name, desiredRoleName),
  });
  if (!role) return;
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(userRoles)
      .values({ userId, roleId: role.id })
      .onConflictDoNothing()
      .returning({ roleId: userRoles.roleId });
    if (inserted.length === 0) return;
    await requireTwoFactorForPlatformRole(tx, { userId, roleId: role.id, actor: null });
  });
}
