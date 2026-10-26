import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { cachedIsPlatformAdmin } from "@/lib/nav-data";
import { readIsPlatformAdmin } from "@/lib/platform-admin";
import {
  decideDeveloperAccess,
  type AccessVerdict,
} from "@/lib/developer-portal/access";

/**
 * The one gate for every /developer surface.
 *
 * A schema browser plus a permission catalog is a map of the application, so it
 * stays behind an entitlement and renders structure only: never data, not even
 * per-tenant row counts.
 *
 * Three outcomes (DECISION-258), decided by the pure `decideDeveloperAccess`:
 *   - `ok`: render.
 *   - `forbidden`: the viewer is signed in but not entitled. The page renders a
 *     calm "doesn't include" state with HTTP 200 and NO redirect: a silent
 *     bounce to /home reads as revoked access or a bug (F288).
 *   - `unavailable`: the predicate read threw. Fails closed, says the fault is
 *     ours, and offers a retry. Never `forbidden`, never Next's default page.
 * Signed-out and required-but-unverified-2FA are redirects, taken here and
 * never by a layout.
 *
 * THE PREDICATE IS READ LIVE from `users.is_platform_admin` (DECISION-044), not
 * from a session claim, so revoking it takes effect immediately instead of at
 * the next token refresh. Increment 2 changes the two readers below and
 * `cachedIsPlatformAdmin` in `src/lib/nav-data.ts`, and nothing else.
 */
export type DeveloperGate = "ok" | "forbidden" | "unavailable";

/**
 * Per-request memoized read, for pages and the layout. It IS the header's
 * `cachedIsPlatformAdmin`, so the layout, the page and the avatar menu share one
 * query per render.
 */
export const readEntitled: (userId: string) => Promise<boolean> =
  cachedIsPlatformAdmin;

/** Uncached read, for the route handler (`cache()` is a no-op there). */
export const readEntitledUncached: (userId: string) => Promise<boolean> =
  readIsPlatformAdmin;

// One segment: letters, digits and the URL-safe punctuation a table name or a
// module slug can contain, plus `%` for percent-encoding.
const RETURN_TO = /^\/developer(\/[A-Za-z0-9_~%.-]+)*$/;

/**
 * `returnTo` is built from a URL param, so it is untrusted. Accept only a path
 * inside this tree, and refuse any segment that decodes to something that could
 * climb out of it. Anything else becomes `/developer`. /signin and /totp still
 * run `sanitizeCallbackUrl` on the way out: this is a second lock, not the only
 * one.
 */
export function safeReturnTo(returnTo: string): string {
  if (!RETURN_TO.test(returnTo)) return "/developer";
  for (const segment of returnTo.split("/").slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return "/developer";
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return "/developer";
    }
  }
  return returnTo;
}

/**
 * Gate for pages. Call it first, before `await params`-dependent reads,
 * `notFound()` and any data call, so a non-entitled viewer gets one answer for
 * every URL and cannot tell a real table from a missing one.
 *
 * `redirect()` works by throwing, so it is called outside any try (the /launch
 * precedent).
 */
export async function requireDeveloper(returnTo: string): Promise<DeveloperGate> {
  const session = await cachedAuth();
  const verdict = await decideDeveloperAccess({
    user: session?.user,
    readEntitled,
  });
  const path = safeReturnTo(returnTo);

  if (verdict === "signed_out") {
    redirect(`/signin?callbackUrl=${encodeURIComponent(path)}`);
  }
  if (verdict === "two_factor_required") {
    redirect(`/totp?callbackUrl=${encodeURIComponent(path)}`);
  }
  return verdict as DeveloperGate;
}

/**
 * Gate for `schema.json`. Returns the verdict and lets the handler map it to a
 * status, because a route handler answers JSON rather than redirecting.
 */
export async function checkDeveloperApiRequest(): Promise<AccessVerdict> {
  const session = await auth();
  return decideDeveloperAccess({
    user: session?.user,
    readEntitled: readEntitledUncached,
  });
}

/**
 * TRANSITIONAL: the three pre-portal pages still call this until Batch C
 * replaces each call with `requireDeveloper` and `GateState`. It keeps their
 * old behaviour (non-entitled to /home, a failed read throws) while gaining the
 * 2FA and signed-out redirects. Batch C deletes it.
 */
export async function requirePlatformAdmin(returnTo: string): Promise<void> {
  const gate = await requireDeveloper(returnTo);
  if (gate === "forbidden") redirect("/home");
  if (gate === "unavailable") throw new Error("developer gate unavailable");
}
