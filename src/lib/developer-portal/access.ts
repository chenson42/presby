/**
 * The developer portal's access decision, as a pure function.
 *
 * No imports on purpose: the decision is a few lines of ordering, and the order
 * is the whole point, so it must be testable without mocking a session library
 * or a database. `guard.ts` (pages) and `checkDeveloperApiRequest`
 * (`schema.json`) both call it, so a page and the machine-readable twin cannot
 * disagree about who is let in.
 *
 * Order matters:
 *   1. No user: signed out.
 *   2. A required second factor that is not yet verified: challenge it BEFORE
 *      reading the predicate. The proxy does the same at the Edge (F284); this
 *      is the second layer for a caller that bypasses it.
 *   3. The predicate read. Only the read sits in the `try`: a throw is
 *      `unavailable` (fail closed, and honest that the fault is ours), never
 *      `forbidden`, which would tell an entitled person their access was removed.
 *   4. `ok` or `forbidden`.
 *
 * Increment 2 changes what `readEntitled` reads, not this function.
 */

export type AccessVerdict =
  | "signed_out"
  | "two_factor_required"
  | "ok"
  | "forbidden"
  | "unavailable";

export async function decideDeveloperAccess(input: {
  user:
    | { id: string; twoFactorRequired?: boolean; twoFactorVerified?: boolean }
    | null
    | undefined;
  readEntitled: (userId: string) => Promise<boolean>;
}): Promise<AccessVerdict> {
  const { user } = input;
  if (!user) return "signed_out";

  if (user.twoFactorRequired && !user.twoFactorVerified) {
    return "two_factor_required";
  }

  let entitled: boolean;
  try {
    entitled = await input.readEntitled(user.id);
  } catch {
    return "unavailable";
  }

  return entitled ? "ok" : "forbidden";
}
