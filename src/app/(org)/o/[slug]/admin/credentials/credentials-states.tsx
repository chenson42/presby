import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/credentials` can give
 * (a fourth — an unauthorized org, or a 404 slug — is handled one level up
 * by `org-states.tsx`/`not-found.tsx`, reused as-is). Modeled directly on
 * `../officers/officers-states.tsx` verbatim, per Phase 3's own instruction
 * to mirror that tree.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (same rationale as
 * `officers-states.tsx`):
 *   - flag off: a product-not-here message, no permission or error framing.
 *   - forbidden: a permission message, worded so it does NOT read as "your
 *     whole portal access was revoked."
 *   - load error: a broken-right-now message with a retry.
 */

/** `org_portal.credentials` is off. A product-not-here message, not a denial. */
export function CredentialsFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Ministry credentials & pastoral appointments isn&apos;t turned on for{" "}
        {name} yet.
      </p>
    </section>
  );
}

/**
 * A `CredentialsResult` returned `{ kind: "forbidden" }` — the viewer has an
 * active relationship with the organization but holds no `credentials
 * .manage` grant. Worded deliberately unlike `OrgAccessDenied`.
 */
export function CredentialsForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage ministry credentials at{" "}
        {name}. If you think this is a mistake, ask your stated clerk or
        another administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading credentials data (a DB
 * blip, most likely). The retry is a plain `<Link>` — this stays a Server
 * Component, so there is no client `reset()` to call.
 */
export function CredentialsLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Credentials</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load credentials records right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/credentials`}>Try again</Link>
      </Button>
    </section>
  );
}
