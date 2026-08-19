"use server";

import { signOut } from "@/auth";

/**
 * Sign out, and land on the marketing home page.
 *
 * A MODULE rather than another inline `async () => { "use server"; … }`, because
 * the avatar menu is a client component and a client component cannot define a
 * server action inline. Passing one down as a prop would work, but every shell
 * that renders the menu — `(member)` and `(org)` today, `(account)` and
 * `(admin)` when they adopt it — would have to drill an identical closure, and
 * the four existing inline copies in this repo are already three too many.
 *
 * Behavior is byte-identical to the inline form it replaces:
 * `signOut({ redirectTo: "/" })`. It throws NEXT_REDIRECT, so nothing after it
 * runs and it has no return value to check.
 *
 * `auth()` is NOT called here, and `cachedAuth()` must never be — a sign-out is
 * a NextAuth flow, not a session read (see cached-auth.ts).
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
