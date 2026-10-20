import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import {
  getDonor,
  getDonorReduced,
  type DonorDetail,
  type DonorReduced,
} from "@/lib/giving/donors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GivingLoadError } from "../../giving-admin-states";
import { gateGivingPage } from "../../giving-page-gate";
import { DonorForm } from "../donor-form";
import { LinkPanel } from "../link-panel";
import { MergeDonorDialog } from "../merge-dialog";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_CLASS =
  "text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * `/o/<slug>/admin/giving/donors/[donorId]` - one donor. docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Pages to create" and S4.
 *
 *   giving.view    the full page: contact detail, the member link, possible
 *                  duplicates, a link to this donor's gifts, and (with
 *                  `giving.manage`) edit and merge.
 *   giving.record  (without view) the REDUCED page: a name, a kind and the
 *                  member link/suggestion - never the email, address, gifts or
 *                  totals. The reduced read selects only those columns, so
 *                  there is nothing to leak by a rendering mistake.
 *
 * A donor merged into another redirects to the survivor. A donor that is not in
 * THIS organization is a plain 404, the same as a malformed id. No `loading.tsx`.
 */
export default async function GivingDonorPage({
  params,
}: {
  params: Promise<{ slug: string; donorId: string }>;
}) {
  const { slug, donorId } = await params;
  const path = `/o/${slug}/admin/giving/donors/${donorId}`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["view", "record"], section: "Donors" });
  if (!gate.ok) return gate.node;
  if (!UUID.test(donorId)) notFound();

  const back = (
    <Link
      href={`/o/${slug}/admin/giving/donors`}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      Back to Donors
    </Link>
  );

  // ---- reduced variant (S4) --------------------------------------------------
  if (!gate.has.view) {
    let reducedResult: Awaited<ReturnType<typeof getDonorReduced>> | null = null;
    try {
      reducedResult = await getDonorReduced(gate.org.personId, gate.org.organizationId, donorId);
    } catch (err) {
      if (err instanceof OrgAccessError) throw err;
    }
    if (reducedResult?.kind === "not_found") notFound();
    if (!reducedResult || reducedResult.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;
    const donor: DonorReduced = reducedResult.donor;
    return (
      <div className="max-w-2xl space-y-6">
        {back}
        <div>
          <h1 className="text-2xl font-semibold">{donor.displayName}</h1>
          {donor.kind === "unidentified" && (
            <div className="mt-2">
              <Badge variant="outline">Plate offering</Badge>
            </div>
          )}
        </div>
        <section aria-labelledby="donor-link" className="space-y-3">
          <h2 id="donor-link" className="text-xl font-semibold">
            Member link
          </h2>
          {donor.kind === "unidentified" ? (
            <p className="text-sm text-muted-foreground">A plate offering has no donor to link to a member.</p>
          ) : (
            <LinkPanel slug={slug} donorId={donor.id} link={donor.link} proposals={donor.proposals} canLink />
          )}
        </section>
      </div>
    );
  }

  // ---- full variant ------------------------------------------------------------
  let fullResult: Awaited<ReturnType<typeof getDonor>> | null = null;
  try {
    fullResult = await getDonor(gate.org.personId, gate.org.organizationId, donorId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
  }
  if (fullResult?.kind === "not_found") notFound();
  if (fullResult?.kind === "merged") redirect(`/o/${slug}/admin/giving/donors/${fullResult.survivorId}`);
  if (!fullResult || fullResult.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;
  const donor: DonorDetail = fullResult.donor;

  const identified = donor.kind === "identified";
  const address = [
    donor.addressLine1,
    donor.addressLine2,
    [donor.city, donor.region, donor.postalCode].filter(Boolean).join(" "),
  ].filter((line) => line && line.length > 0);

  return (
    <div className="max-w-2xl space-y-8">
      {back}
      <div>
        <h1 className="text-2xl font-semibold">{donor.displayName}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!identified && <Badge variant="outline">Plate offering</Badge>}
          {donor.hasProviderIdentity && <Badge variant="secondary">Gives online</Badge>}
          {donor.mergedFromCount > 0 && (
            <Badge variant="secondary">
              Includes {donor.mergedFromCount} merged {donor.mergedFromCount === 1 ? "donor" : "donors"}
            </Badge>
          )}
        </div>
      </div>

      <section aria-labelledby="donor-contact" className="space-y-3">
        <h2 id="donor-contact" className="text-xl font-semibold">
          Contact
        </h2>
        {identified ? (
          <Card>
            <CardContent className="space-y-1">
              <p className="text-base">{donor.email ?? <span className="text-muted-foreground">No email on file</span>}</p>
              {address.length > 0 ? (
                address.map((line) => (
                  <p key={line as string} className="text-base">
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No mailing address on file.</p>
              )}
              {!donor.email && address.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Without an email or address, this donor will be listed as an exception when statements are issued.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            A plate offering has no contact detail and never receives a statement.
          </p>
        )}
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/o/${slug}/admin/giving/gifts?donor=${donor.id}`}>See this donor&apos;s gifts</Link>
        </Button>
      </section>

      {identified && (
        <section aria-labelledby="donor-link" className="space-y-3">
          <h2 id="donor-link" className="text-xl font-semibold">
            Member link
          </h2>
          <LinkPanel
            slug={slug}
            donorId={donor.id}
            link={donor.link}
            proposals={donor.proposals}
            canLink={gate.has.record}
          />
        </section>
      )}

      {identified && donor.possibleDuplicates.length > 0 && (
        <section aria-labelledby="donor-dupes" className="space-y-3">
          <h2 id="donor-dupes" className="text-xl font-semibold">
            Possible duplicates
          </h2>
          <ul className="space-y-2">
            {donor.possibleDuplicates.map((dupe) => (
              <li key={dupe.id} className="space-y-2 rounded-lg border border-border p-4">
                <p className="text-base">
                  <Link href={`/o/${slug}/admin/giving/donors/${dupe.id}`} className={LINK_CLASS}>
                    {dupe.displayName}
                  </Link>
                </p>
                <p className="text-sm text-muted-foreground">
                  {dupe.reason === "same_email" ? "Same email address" : "Same name"}
                </p>
                {gate.has.manage && (
                  <MergeDonorDialog
                    slug={slug}
                    source={{ id: donor.id, displayName: donor.displayName }}
                    target={{ id: dupe.id, displayName: dupe.displayName }}
                    label={`Merge into ${dupe.displayName}`}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {identified && gate.has.manage && (
        <>
          <section aria-labelledby="donor-edit" className="space-y-3">
            <h2 id="donor-edit" className="text-xl font-semibold">
              Edit contact detail
            </h2>
            <Card>
              <CardContent>
                <DonorForm
                  slug={slug}
                  donor={{
                    id: donor.id,
                    displayName: donor.displayName,
                    email: donor.email,
                    addressLine1: donor.addressLine1,
                    addressLine2: donor.addressLine2,
                    city: donor.city,
                    region: donor.region,
                    postalCode: donor.postalCode,
                    country: donor.country,
                  }}
                />
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="donor-merge" className="space-y-3">
            <h2 id="donor-merge" className="text-xl font-semibold">
              Merge with another donor
            </h2>
            <p className="text-sm text-muted-foreground">
              If this giver is in your records twice, merge this donor into the one to keep.
            </p>
            <MergeDonorDialog
              slug={slug}
              source={{ id: donor.id, displayName: donor.displayName }}
              label="Merge into another donor"
            />
          </section>
        </>
      )}
    </div>
  );
}
