import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/staff` (and its
 * `[personId]` sub-route) can give (a fourth — an unauthorized org, or a 404
 * slug — is handled one level up by `org-states.tsx` / `not-found.tsx`, reused
 * as-is rather than duplicated). Modeled directly on
 * `admin/officers/officers-states.tsx`, per Phase 3's own instruction.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (same rationale
 * `officers-states.tsx`'s header documents):
 *   - flag off: a product-not-here message, no permission or error framing.
 *   - forbidden: a permission message, worded so it does NOT read as "your
 *     whole portal access was revoked" — that is `OrgAccessDenied`'s job,
 *     one level up.
 *   - load error: a broken-right-now message with a retry, not a "you can't"
 *     message.
 */

/** `org_portal.staff` is off. A product-not-here message, not a denial. */
export function StaffFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Staff</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Staff and personnel administration isn&apos;t turned on for {name}{" "}
        yet.
      </p>
    </section>
  );
}

/**
 * `listStaffRoster()`/`getStaffHistory()`/`getStaffFormOptions()` returned
 * `{ kind: "forbidden" }` — the viewer has an active relationship with the
 * organization (they got past `assertOrgAccess` to reach this page at all)
 * but holds no `staff.manage` grant. Worded deliberately unlike
 * `OrgAccessDenied`'s "you don't have access to {org}" — a member reading
 * this should understand ONE capability is unavailable to them, not that
 * their whole portal access was revoked.
 */
export function StaffForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Staff</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage staff at {name}. If you
        think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading staff data (a DB blip,
 * most likely). The retry is a plain `<Link>` to the roster path — this
 * stays a Server Component, so there is no client `reset()` to call, unlike
 * `[slug]/error.tsx`. Used by both the roster page and the per-person
 * history page — the retry link always goes back to the roster, since that
 * is always reachable.
 */
export function StaffLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Staff</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load staff records right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/staff`}>Try again</Link>
      </Button>
    </section>
  );
}
