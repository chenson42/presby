/**
 * `findPersonAction()`'s return shape — a portal-home search never redirects
 * or renders on its own (it is a plain async function, not one that calls
 * `redirect()` internally), so the caller needs a value to act on. Modeled on
 * `ActionResult<T>` (`src/types/actions.ts`): a small, named type living
 * outside the `"use server"` file itself, because a file carrying the "use
 * server" directive may only export async functions — see
 * `src/app/(org)/o/[slug]/feedback/actions.ts`'s identical `ActionResult`
 * import for the established precedent.
 *
 * TWO KINDS, both carrying an `href` to navigate to — the caller does not
 * branch on `kind` today (both cases just `router.push(href)`), but the
 * distinction is preserved because Increment 3 changes ONLY the `redirect`
 * case's `href` (to `/o/<slug>/directory/<personId>`, once that route
 * exists) without touching `fallthrough` at all. See
 * `find-person-action.ts`'s own header comment for the increment-1
 * divergence this type's `redirect` case currently carries.
 */
export type FindPersonResult =
  | { kind: "redirect"; href: string }
  | { kind: "fallthrough"; href: string };
