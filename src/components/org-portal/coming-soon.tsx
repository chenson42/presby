import Link from "next/link";

/**
 * The shared "coming soon" component family for the product-IA scaffold's 7
 * placeholder areas (docs/work-log/2026-08-27-product-ia-scaffold.md, Phase
 * 3 §3, DECISION-117). Adopts architect Phase 2 suggestion 5 — one file,
 * three parameterized exports, modeled on `events-states.tsx`'s "distinct
 * copy blocks, one file" precedent — INSTEAD of ~7-10 near-duplicate
 * `*FlagOff`/`*NotAvailable` files, one per placeholder area. Only the
 * PER-AREA duplication is collapsed here; the underlying TWO STATES
 * (flag-off vs. coming-soon) are NOT collapsed into one (architect ruling 4:
 * "flag-off ≠ coming-soon" — two different truths).
 *
 * Every export here is presentational only: no data fetch, no mutation, no
 * native dialog. Each of the 7 `page.tsx` routes under `admin/<area>/`
 * chooses among these three based on its own flag/org-type check, following
 * the exact `EventsPage`/`CredentialsPage` ordering (flag check, then
 * org-type check where applicable) — never the reverse.
 */

/**
 * Flag OFF — reachable, 200, honest "isn't turned on yet." Mirrors
 * `EventsFlagOff`'s/`CredentialsFlagOff`'s convention, parameterized instead
 * of duplicated per area (architect ruling 4's direct-hit-flag-off
 * behavior: reachable, 200, not `notFound()` — that stays reserved for
 * DECISION-040's org-existence axis).
 */
export function PlaceholderFlagOff({
  area,
  orgName,
}: {
  area: string;
  orgName: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{area}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {area} isn&apos;t turned on for {orgName} yet.
      </p>
    </section>
  );
}

/**
 * Flag ON, but this organization's type isn't a candidate for this area
 * (e.g. a congregation/synod/GA org reaching a presbytery-only placeholder
 * route directly). Mirrors `CredentialsNotAvailable`'s tone deliberately:
 * product-not-here, no implied remedy, no permission language — "ask your
 * administrator" would be actively wrong here, since no role at this kind
 * of organization could ever turn the feature on for it.
 */
export function PlaceholderNotAvailable({
  area,
  orgName,
}: {
  area: string;
  orgName: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{area}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {area} isn&apos;t available for {orgName} — this isn&apos;t the kind
        of organization this tool is built for.
      </p>
    </section>
  );
}

/**
 * Flag ON, org-type OK (or the area has no `orgTypeScope`) — the actual
 * "coming soon" state. Names what's planned in the caller-supplied
 * `description`, honest tone, no fake date; links back to the org home and
 * into feedback ("want this sooner? tell us"), per Phase 3 §3's exact
 * contract.
 */
export function ComingSoon({
  area,
  description,
  slug,
}: {
  area: string;
  description: string;
  slug: string;
}) {
  return (
    <section className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{area}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <p className="text-sm text-muted-foreground">Coming soon.</p>
      <div className="flex flex-wrap gap-4 pt-2">
        <Link
          href={`/o/${slug}`}
          className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ← Back to your organization
        </Link>
        <Link
          href={`/o/${slug}/feedback`}
          className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Want this sooner? Tell us.
        </Link>
      </div>
    </section>
  );
}
