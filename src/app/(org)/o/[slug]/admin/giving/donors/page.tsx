import Link from "next/link";
import { OrgAccessError } from "@/lib/authz";
import {
  listDonors,
  listPossibleDuplicates,
  listWaitingLinkSuggestions,
  searchDonors,
  type DonorListRow,
  type DonorPickerRow,
  type DuplicatePair,
} from "@/lib/giving/donors";
import type { LinkSuggestion } from "@/lib/giving/link-proposals";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/giving/form-field";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { DonorForm } from "./donor-form";
import { DonorsList } from "./donors-list";

const LINK_CLASS =
  "text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * `/o/<slug>/admin/giving/donors` - donors. docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Pages to create" and the S4 scope.
 *
 *   giving.view    the full list (name, email, location, the linked member),
 *                  search, the possible-duplicates panel, the suggestions panel
 *   giving.record  (without view) the REDUCED variant: a name search whose
 *                  results are names only, the suggestions panel, and "add a
 *                  donor". No email, no address, no gifts.
 *   giving.record  (either variant) can add a donor.
 *
 * Search is a GET form (`?q=`): shareable, no JavaScript needed. A database
 * failure is an honest load-error state, never an empty list. No `loading.tsx`.
 */
export default async function GivingDonorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const q = typeof raw.q === "string" ? raw.q.trim().slice(0, 80) : "";
  const cursor = typeof raw.cursor === "string" ? raw.cursor : undefined;
  const path = `/o/${slug}/admin/giving/donors`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view", "record"], section: "Donors" });
  if (!gate.ok) return gate.node;

  let full: { donors: DonorListRow[]; nextCursor: string | null } | null = null;
  let reduced: DonorPickerRow[] | null = null;
  let pairs: DuplicatePair[] = [];
  let suggestions: LinkSuggestion[] = [];
  let failed = false;
  try {
    const { personId, organizationId } = gate.org;
    const sugg = await listWaitingLinkSuggestions(personId, organizationId);
    if (sugg.kind === "ok") suggestions = sugg.suggestions;
    else failed = true;

    if (!failed && gate.has.view) {
      const [list, dupes] = await Promise.all([
        listDonors(personId, organizationId, { q, cursor }),
        listPossibleDuplicates(personId, organizationId),
      ]);
      if (list.kind === "ok" && dupes.kind === "ok") {
        full = { donors: list.donors, nextCursor: list.nextCursor };
        pairs = dupes.pairs;
      } else {
        failed = true;
      }
    } else if (!failed && q.length >= 2) {
      const found = await searchDonors(personId, organizationId, q);
      if (found.kind === "ok") reduced = found.donors;
      else failed = true;
    }
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    failed = true;
  }
  if (failed) return <GivingLoadError slug={slug} href={path} />;

  return (
    <div className="max-w-3xl space-y-8">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Donors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {gate.has.view
            ? `Everyone who gives to ${gate.org.name}.`
            : "Look up a donor by name, or add a new one. You can link a donor to a member when their email matches."}
        </p>
      </div>

      <form method="get" action={path} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <FormField id="donor-search" label="Search by name" className="flex-1">
          <Input id="donor-search" type="search" name="q" defaultValue={q} autoComplete="off" />
        </FormField>
        <Button type="submit" className="min-h-11">
          Search
        </Button>
      </form>

      {suggestions.length > 0 && (
        <section aria-labelledby="donor-suggestions" className="space-y-3">
          <h2 id="donor-suggestions" className="text-xl font-semibold">
            Member suggestions
          </h2>
          <p className="text-sm text-muted-foreground">
            These donors share an email with a member. Open one to confirm the link or say it isn&apos;t them.
          </p>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={`${s.donorId}-${s.membershipId}`} className="rounded-lg border border-border p-4">
                <Link href={`${path}/${s.donorId}`} className={`inline-flex min-h-11 items-center text-base font-medium ${LINK_CLASS}`}>
                  {s.donorName}
                </Link>
                <p className="text-sm text-muted-foreground">Looks like {s.personName}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gate.has.view && pairs.length > 0 && (
        <section aria-labelledby="donor-dupes" className="space-y-3">
          <h2 id="donor-dupes" className="text-xl font-semibold">
            Possible duplicates
          </h2>
          <ul className="space-y-2">
            {pairs.map((pair) => (
              <li key={`${pair.aId}-${pair.bId}`} className="rounded-lg border border-border p-4">
                <p className="text-base">
                  <Link href={`${path}/${pair.aId}`} className={LINK_CLASS}>
                    {pair.aName}
                  </Link>{" "}
                  and{" "}
                  <Link href={`${path}/${pair.bId}`} className={LINK_CLASS}>
                    {pair.bName}
                  </Link>
                </p>
                <p className="text-sm text-muted-foreground">
                  {pair.reason === "same_email" ? "Same email address" : "Same name"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="donor-results" className="space-y-3">
        <h2 id="donor-results" className="text-xl font-semibold">
          {q ? "Search results" : "All donors"}
        </h2>
        {full ? (
          full.donors.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-12 text-center">
              <p className="text-sm font-medium">{q ? "No donors match that search" : "No donors yet"}</p>
              <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
                {q
                  ? "Check the spelling, or add them as a new donor below."
                  : "Donors are added when you record a gift, or you can add one below."}
              </p>
            </div>
          ) : (
            <DonorsList slug={slug} donors={full.donors} showContact />
          )
        ) : q.length < 2 ? (
          <p className="text-sm text-muted-foreground">Type at least two letters of a name and search.</p>
        ) : reduced && reduced.length > 0 ? (
          <DonorsList slug={slug} donors={reduced} showContact={false} />
        ) : (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <p className="text-sm font-medium">No donors match that search</p>
            <p className="mx-auto mt-1 max-w-md px-4 text-sm text-muted-foreground">
              Check the spelling, or add them as a new donor below.
            </p>
          </div>
        )}
        {full?.nextCursor && (
          <div className="flex justify-center">
            <Button asChild variant="outline" className="min-h-11">
              <Link href={`${path}?${new URLSearchParams({ ...(q ? { q } : {}), cursor: full.nextCursor }).toString()}`}>
                Show more donors
              </Link>
            </Button>
          </div>
        )}
      </section>

      {gate.has.record && (
        <section aria-labelledby="donor-add" className="space-y-3">
          <h2 id="donor-add" className="text-xl font-semibold">
            Add a donor
          </h2>
          <Card>
            <CardContent>
              <DonorForm slug={slug} />
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
