import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/tickets*` can give (a
 * fourth — an unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is). Modeled directly on
 * `admin/roles/roles-states.tsx` — same three-block structure and copy
 * register, same "a reader who only skims one of these three should not be
 * able to guess what the other two say" discipline.
 */

/** `org_portal.tickets` is off. A product-not-here message, not a denial. */
export function TicketsFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Tickets</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Support tickets aren&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}

/**
 * `listTickets()`/`getTicketThread()`/etc. returned `{ kind: "forbidden" }` —
 * the viewer has an active relationship with the organization but holds no
 * `tickets.file` grant. Worded deliberately unlike `OrgAccessDenied`'s "you
 * don't have access to {org}" — a member reading this should understand ONE
 * capability is unavailable, not that their whole portal access was revoked.
 */
export function TicketsForbidden({
  name,
  slug,
}: {
  name: string;
  /**
   * Absolute, not relative — this component renders from three different
   * route depths (`tickets/page.tsx`, `tickets/new/page.tsx`,
   * `tickets/[id]/page.tsx`), so a relative `href` would resolve differently
   * at each one.
   */
  slug: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Tickets</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to file or manage support tickets at{" "}
        {name}. If you have a problem to report, use{" "}
        <Link
          href={`/o/${slug}/feedback`}
          className="underline underline-offset-4 hover:no-underline"
        >
          the feedback form
        </Link>{" "}
        instead — a designated role-holder there reviews it.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure (a DB blip, most likely). The
 * retry is a plain `<Link>` to the same path — this stays a Server
 * Component, so there is no client `reset()` to call, unlike `[slug]/error.tsx`.
 */
export function TicketsLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Tickets</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load tickets right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/tickets`}>Try again</Link>
      </Button>
    </section>
  );
}
