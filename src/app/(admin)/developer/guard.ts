import "server-only";
import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { readIsPlatformAdmin } from "@/lib/platform-admin";

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

  if (!(await readIsPlatformAdmin(session.user.id))) redirect("/home");
}
