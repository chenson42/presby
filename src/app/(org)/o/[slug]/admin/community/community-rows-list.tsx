import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { CommunityRow } from "@/lib/community";
import type { CommunityView } from "@/lib/community-labels";
import type { SignInMarker as Marker } from "@/lib/onboarding/sign-in-types";
import { CONNECTION_LABELS, deriveConnection } from "@/lib/community-labels";
import { CommunityRowActions } from "./community-row-actions";
import { SignInMarker } from "./sign-in-marker";

/**
 * Cards for the four admin-only lists (Visitors, Inactive, Staff, Former). Each
 * links to the person's edit page, because a visitor or staff anchor has no
 * Directory page (DECISION-129/200). The detail line is "First visit {date}",
 * "Inactive" or "Moved away", the open position titles, or how the connection
 * ended ("Removed {date}", "Archived visitor, {date}", "Archived, {date}"). A
 * Staff row with no open position is a staff anchor (an invited administrator
 * or treasurer): it reads "No position yet", with a link to the Staff page when
 * the viewer can use it.
 *
 * Visitors, Inactive and the archived Former rows carry their row buttons
 * (`CommunityRowActions`) on a line of their own beneath the person, so a
 * 360px row never squeezes the name beside three buttons.
 */
export function CommunityRowsList({
  slug,
  view,
  rows,
  markers = {},
  canStaffLink = false,
  organization = "",
  selfConnectEnabled = null,
}: {
  slug: string;
  view: Extract<CommunityView, "visitors" | "inactive" | "staff" | "former">;
  rows: CommunityRow[];
  /** Sign-in markers by person id; empty unless the viewer holds `people.manage`. */
  markers?: Record<string, Marker>;
  /** `org_portal.staff` is on and the viewer holds `staff.manage`. */
  canStaffLink?: boolean;
  /** The organization's name, for the archive and restore dialogs. */
  organization?: string;
  /** `org_portal.sign_in_connect`; null when the page could not read it. */
  selfConnectEnabled?: boolean | null;
}) {
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.personId}>
          <Card className="py-4">
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="break-words text-lg font-medium">{row.displayName}</h3>
                  {row.email && (
                    <p className="break-all text-sm text-muted-foreground">{row.email}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    <Detail view={view} row={row} slug={slug} canStaffLink={canStaffLink} />
                  </p>
                  <SignInMarker
                    marker={markers[row.personId]}
                    slug={slug}
                    personId={row.personId}
                    personName={row.displayName}
                  />
                </div>
                <Button asChild variant="outline" className="min-h-11 shrink-0">
                  <Link href={`/o/${slug}/admin/community/${row.personId}/edit`}>
                    Edit
                    <span className="sr-only"> {row.displayName}</span>
                  </Link>
                </Button>
              </div>
              {view !== "staff" && (
                <CommunityRowActions
                  slug={slug}
                  view={view}
                  personId={row.personId}
                  personName={row.displayName}
                  organization={organization}
                  engagementStatus={row.engagementStatus}
                  archived={isArchived(row)}
                  signInConnected={row.signInConnected}
                  hasAddress={row.email !== null}
                  invitationOpen={markers[row.personId]?.kind === "pending"}
                  selfConnectEnabled={selfConnectEnabled}
                />
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function Detail({
  view,
  row,
  slug,
  canStaffLink,
}: {
  view: "visitors" | "inactive" | "staff" | "former";
  row: CommunityRow;
  slug: string;
  canStaffLink: boolean;
}) {
  if (view === "visitors") {
    return row.firstVisitDate ? (
      <>
        First visit <FormattedDate value={row.firstVisitDate} mode="date" />
      </>
    ) : (
      <>Visitor</>
    );
  }
  if (view === "inactive") {
    return <>{row.engagementStatus === "moved_away" ? "Moved away" : "Inactive"}</>;
  }
  if (view === "staff") {
    if (row.positions.length > 0) return <>{row.positions.join(", ")}</>;
    return (
      <>
        No position yet
        {canStaffLink && (
          <>
            {" "}
            &middot;{" "}
            <Link
              href={`/o/${slug}/admin/staff`}
              className="inline-flex min-h-11 items-center underline underline-offset-2"
            >
              Add a position
              <span className="sr-only"> for {row.displayName}</span>
            </Link>
          </>
        )}
      </>
    );
  }
  // Former: the removal marker is a participant removal; the archive marker is
  // an archived visitor when the engagement kept on the row is Visitor and plain
  // archived otherwise (the same split `deriveConnection` makes).
  const connection = deriveConnection({
    endedOn: row.endedOn,
    endedReason: row.endedReason,
    currentRoll: null,
    engagementStatus: row.engagementStatus,
  });
  const label =
    connection === "former_visitor" || connection === "archived"
      ? CONNECTION_LABELS[connection]
      : "Removed";
  return row.endedOn ? (
    <>
      {label}
      {label === "Removed" ? " " : ", "}
      <FormattedDate value={row.endedOn} mode="date" />
    </>
  ) : (
    <>{label}</>
  );
}

/** A Former row that ended by an archive (restorable), by the same derivation the connection labels use. */
function isArchived(row: CommunityRow): boolean {
  const connection = deriveConnection({
    endedOn: row.endedOn,
    endedReason: row.endedReason,
    currentRoll: null,
    engagementStatus: row.engagementStatus,
  });
  return connection === "former_visitor" || connection === "archived";
}
