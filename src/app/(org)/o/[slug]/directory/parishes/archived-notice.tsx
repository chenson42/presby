import type { ReactNode } from "react";
import { ARCHIVED_BASE_COPY, archivedMoveSentence, type ArchivedMoveState } from "./parish-copy";

/**
 * The notice at the top of an ARCHIVED district's page (copy C3): the district
 * is archived and nothing can be moved into it, plus the sentence for the
 * `state` the PAGE chose with `archivedMoveState()` - the same value that
 * decides which child (`children`) the page renders beneath, so the sentence
 * that promises a way out cannot disagree with the control under it
 * (QA run 1, Finding 3). In `none` (the viewer cannot move households, or there
 * are none) the notice says nothing about moving and renders no child.
 * Server-rendered and prop-driven.
 */
export function ArchivedNotice({
  householdCount,
  state,
  children,
}: {
  householdCount: number;
  state: ArchivedMoveState;
  children?: ReactNode;
}) {
  return (
    <div
      className="mt-4 rounded-lg border border-border bg-muted/40 p-4"
      data-testid="archived-notice"
    >
      <p className="text-sm">
        {ARCHIVED_BASE_COPY}
        {archivedMoveSentence(state)}
        {householdCount === 0 ? " It has no households." : null}
      </p>
      {state !== "none" && children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
