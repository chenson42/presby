import "server-only";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

/**
 * Gate for every /developer surface.
 *
 * A schema browser plus a permission catalog is a map of the application, so it
 * stays behind platform admin and renders structure only — never data, not even
 * per-tenant row counts.
 *
 * Reads the flag from the database rather than the session so revoking platform
 * admin takes effect immediately instead of at the next token refresh.
 */
export async function requirePlatformAdmin(returnTo: string) {
  const session = await cachedAuth();
  if (!session?.user) redirect(`/signin?callbackUrl=${encodeURIComponent(returnTo)}`);

  const [me] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!me?.isPlatformAdmin) redirect("/home");
}
