"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  PROVENANCE_COPY,
  derivedRowText,
  groupRowCount,
  groupRowTitle,
  revokeButtonLabel,
  rowAlsoThrough,
  rowRoles,
  rowSince,
} from "@/lib/onboarding/designation-holder-copy";
import type { DesignationSlot, HolderRow } from "@/lib/onboarding/designation-holder-types";
import { RevokeHolderDialog } from "./revoke-holder-dialog";

/**
 * The current holders of a designation slot, one row per person or group
 * (DECISION-195: display name only, never an email, and a group's members are
 * never named). Shared by the founding-administrator and treasurer sections;
 * `page.tsx` hands it plain `HolderRow`s read from the same list the holder
 * count is derived from (F169), so every counted holder is a row here, each
 * either revocable or explained.
 *
 * A row stacks on a phone (name, details, then a full-width 44px Revoke) and
 * sits side by side from `sm:` up; every text node wraps (`break-words`), so a
 * long group name never scrolls the page sideways. A derived group (session,
 * diaconate, active membership) shows the explanation in place of the button
 * (D6: the congregation's own officers change that roster).
 *
 * The wording never contains "Self-designated" or "Accepted": those are
 * invitation facts, shown on the invitation history rows below this list.
 */
export function DesignationHolderList({
  organizationId,
  organizationName,
  slot,
  holders,
  onRevoked,
}: {
  organizationId: string;
  organizationName: string;
  slot: DesignationSlot;
  holders: HolderRow[];
  onRevoked: (message: string) => void;
}) {
  if (holders.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2" data-testid="designation-holder-list">
      {holders.map((row) => (
        <HolderListItem
          key={row.key}
          organizationId={organizationId}
          organizationName={organizationName}
          slot={slot}
          row={row}
          onRevoked={onRevoked}
        />
      ))}
    </ul>
  );
}

function HolderListItem({
  organizationId,
  organizationName,
  slot,
  row,
  onRevoked,
}: {
  organizationId: string;
  organizationName: string;
  slot: DesignationSlot;
  row: HolderRow;
  onRevoked: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isGroup = row.subjectKind === "group";
  const alsoThrough = rowAlsoThrough(row);

  return (
    <li
      data-testid="designation-holder-row"
      className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0 space-y-0.5">
        <p className="break-words font-medium text-foreground">
          {isGroup ? groupRowTitle(row) : row.displayName}
        </p>
        {isGroup && row.revocable && (
          <p className="break-words text-muted-foreground">{groupRowCount(row)}</p>
        )}
        <p className="break-words text-muted-foreground">
          {rowSince(row)} · {PROVENANCE_COPY[row.provenance]}
        </p>
        <p className="break-words text-muted-foreground">{rowRoles(row)}</p>
        {alsoThrough && <p className="break-words text-muted-foreground">{alsoThrough}</p>}
        {!row.revocable && (
          <p className="break-words text-muted-foreground" data-testid="derived-holder-note">
            {derivedRowText(row)}
          </p>
        )}
      </div>
      {row.revocable && (
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full shrink-0 sm:w-auto"
            aria-label={revokeButtonLabel(row)}
            onClick={() => setOpen(true)}
          >
            Revoke
          </Button>
          <RevokeHolderDialog
            open={open}
            onOpenChange={setOpen}
            organizationId={organizationId}
            organizationName={organizationName}
            slot={slot}
            row={row}
            onRevoked={onRevoked}
          />
        </>
      )}
    </li>
  );
}
