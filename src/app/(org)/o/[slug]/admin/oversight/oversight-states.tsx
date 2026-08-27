import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The non-data-bearing answers `/o/<slug>/admin/oversight` can give, beyond
 * the shared `PlaceholderFlagOff`/`PlaceholderNotAvailable`
 * (`@/components/org-portal/coming-soon`) this route keeps reusing verbatim
 * (Phase 3: "same auth/flag/org-type-check three-step the stub already
 * runs — only the final branch changes"). Modeled on
 * `../credentials/credentials-states.tsx`'s `Forbidden`/`LoadError` pair.
 */

/** A `PresbyteryResult` returned `{ kind: "forbidden" }` — an active
 *  relationship at this presbytery, but no `congregation_oversight.manage`
 *  grant. */
export function OversightForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Congregation Oversight</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage congregation oversight
        records at {name}. If you think this is a mistake, ask your
        presbytery&apos;s administrator.
      </p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure. */
export function OversightLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Congregation Oversight</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load oversight records right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/oversight`}>Try again</Link>
      </Button>
    </section>
  );
}
