"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { isApprovableKind } from "@/lib/roll-action-kinds";
import type { PendingQueueViewer, PendingRollAction } from "@/lib/roll";
import { useHydrated } from "@/components/shared/use-hydrated";
import { BulkApproveDialog } from "./bulk-approve-dialog";
import { PendingRow } from "./pending-row";

function canSelect(action: PendingRollAction): boolean {
  return (
    isApprovableKind(action.kind) &&
    !action.membershipEnded &&
    !action.personDeceased
  );
}

/**
 * The queue. In decide mode rows are selectable (only rows approval would not
 * refuse outright), "Select all on this page" picks every selectable row on the
 * page (page size equals the bulk cap, so it can never exceed what one submit
 * accepts), and a sticky "Approve N selected" bar appears with bottom padding on
 * the list so it never covers the last row. Read mode (a propose-only holder)
 * renders no checkbox, Approve or Deny.
 */
export function PendingWorklist({
  slug,
  actions,
  mode,
  viewer,
  today,
}: {
  slug: string;
  actions: PendingRollAction[];
  mode: "decide" | "read";
  viewer: PendingQueueViewer;
  /** 'YYYY-MM-DD' (UTC), computed on the server so SSR and the client agree. */
  today: string;
}) {
  const hydrated = useHydrated();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const selectableIds = useMemo(
    () => actions.filter(canSelect).map((a) => a.id),
    [actions],
  );
  // Rows that left the page (approved elsewhere or by this run) fall out of the
  // selection without an effect.
  const selected = useMemo(
    () => actions.filter((a) => picked.has(a.id) && canSelect(a)),
    [actions, picked],
  );

  if (actions.length === 0) {
    return mode === "decide" ? (
      <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center">
        <p className="text-sm font-medium">Nothing waiting for your approval</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Roll actions proposed by the clerk or other administrators will show up
          here.
        </p>
      </div>
    ) : (
      <div className="rounded-lg border border-dashed border-border px-4 py-16 text-center">
        <p className="text-sm font-medium">Nothing is waiting</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Member proposals you make appear here until the Session decides them.
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected =
    selectableIds.length > 0 && selected.length === selectableIds.length;

  return (
    <div>
      {mode === "decide" && selectableIds.length > 0 && (
        <div className="mb-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated}
            onClick={() =>
              setPicked(allSelected ? new Set() : new Set(selectableIds))
            }
          >
            {allSelected ? "Clear selection" : "Select all on this page"}
          </Button>
        </div>
      )}

      <ul className={mode === "decide" ? "space-y-3 pb-4" : "space-y-3"}>
        {actions.map((action) => (
          // `scroll-mb-28`: a row focused or scrolled into view stops above the
          // sticky bar instead of under it.
          <li key={action.id} className="scroll-mb-28">
            <PendingRow
              slug={slug}
              action={action}
              mode={mode}
              viewer={viewer}
              today={today}
              selectable={canSelect(action)}
              selected={picked.has(action.id) && canSelect(action)}
              onToggle={toggle}
            />
          </li>
        ))}
      </ul>

      {mode === "decide" && selected.length > 0 && (
        <div
          data-testid="bulk-bar"
          className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:mx-0 sm:rounded-lg sm:border"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {selected.length} selected
            </p>
            <BulkApproveDialog
              slug={slug}
              selected={selected}
              onDone={() => setPicked(new Set())}
            />
          </div>
        </div>
      )}
    </div>
  );
}
