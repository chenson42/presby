"use server";

import { signOut } from "@/auth";

/**
 * Sign out, landing on `redirectTo` (default: the marketing home page).
 *
 * A MODULE rather than another inline `async () => { "use server"; … }`, because
 * the avatar menu is a client component and a client component cannot define a
 * server action inline. Passing one down as a prop would work, but every shell
 * that renders the menu — `(member)` and `(org)` today, `(account)` and
 * `(admin)` when they adopt it — would have to drill an identical closure, and
 * the four existing inline copies in this repo are already three too many.
 *
 * `redirectTo` is bound by the CALLER (`AvatarMenu`'s form action uses
 * `signOutAction.bind(null, redirectTo)` — a server action can take extra
 * bound arguments from a client component this way) so each shell decides its
 * own destination without this module knowing about org slugs or brand
 * context. `(org)/o/[slug]/layout.tsx` binds its own org's public site
 * (`/site/<slug>`) so leaving the portal lands somewhere that still
 * identifies the congregation, rather than the generic platform home; every
 * other caller omits it and keeps today's `/` behavior.
 *
 * No validation on `redirectTo` here: every caller is presby's own trusted
 * server code constructing a same-origin path (a literal `/` or a slug
 * already resolved via `resolveOrgContext()`), never user input — this is not
 * the `sanitizeCallbackUrl()` open-redirect surface, which guards a
 * client-controllable query parameter.
 *
 * It throws NEXT_REDIRECT, so nothing after it runs and it has no return
 * value to check.
 *
 * `auth()` is NOT called here, and `cachedAuth()` must never be — a sign-out is
 * a NextAuth flow, not a session read (see cached-auth.ts).
 */
export async function signOutAction(redirectTo: string = "/"): Promise<void> {
  await signOut({ redirectTo });
}
