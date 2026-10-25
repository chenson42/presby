import type { ReactNode } from "react";

/**
 * The notice at the top of an ARCHIVED district's page (copy C3): the district
 * is archived and nothing can be moved into it; for a viewer who can move
 * households and when it still holds some, the way out (`children`, the bulk
 * control, or the over-cap message). Without authority to move the sentence
 * about moving is omitted entirely, so it never tells someone to do what they
 * cannot. Server-rendered and prop-driven.
 */
export function ArchivedNotice({
  householdCount,
  canMove,
  children,
}: {
  householdCount: number;
  canMove: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="mt-4 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="archived-notice"
    >
      <p className="text-sm">
        This district is archived. No households can be moved into it.
        {canMove && householdCount > 0
          ? " Move households out one at a time, or all at once below."
          : null}
        {householdCount === 0 ? " It has no households." : null}
      </p>
      {canMove && householdCount > 0 && children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
