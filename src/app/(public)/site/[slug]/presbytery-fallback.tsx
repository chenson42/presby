import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * DECISION-121 — the public-site fallback for a presbytery/synod/General
 * Assembly org that has never published a site (and, per the operator's own
 * directive, `docs/work-log/2026-08-27-presbytery-program.md`, may never
 * need to: "the public site can just be the login to the portal right
 * now"). A congregation in the identical situation keeps the untouched,
 * enumeration-safe `notFound()` collapse — this fallback is reachable ONLY
 * for the three non-congregation org types, checked by the caller
 * (`[[...path]]/page.tsx`) BEFORE this component is ever rendered.
 *
 * Minimal by design: org name (already public via the org tree, a bare
 * `select` grant with no RLS policy — `publicOrgSummary()`'s own header) and
 * a sign-in link into `/o/<slug>`. No brand tokens, no site-kit bundle, no
 * content-authoring dependency — a presbytery/synod/GA that never runs a
 * public site is not a broken page, it is this page.
 */
export function PresbyteryFallback({
  name,
  slug,
}: {
  name: string;
  slug: string;
}) {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">{name}</h1>
      <p className="text-sm text-muted-foreground">
        This organization hasn&apos;t published a public site.
      </p>
      <Button asChild className="min-h-11">
        <Link href={`/o/${slug}`}>Sign in to the portal</Link>
      </Button>
    </section>
  );
}
