"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  alreadyHereSentence,
  type Connection,
} from "@/lib/community-labels";

/**
 * Req 7 — the duplicate-match confirm screen. Plain language, two big
 * buttons, NO confidence score rendered anywhere — `displayName` is the
 * ONLY thing shown about the candidate, matching `matchPerson()`'s own
 * minimal-disclosure contract (`presby_match_person()` never returns a
 * birthdate or address pre-confirmation either).
 *
 * ALREADY HERE (F178, DECISION-200): when the candidate already has a
 * membership at THIS organization, "Yes, this is {name}" is not offered (it
 * could only fail at the database) and the screen says how they are connected
 * and links to their record instead. That discloses nothing a `people.manage`
 * holder could not already read at their own organization.
 */
export function ConfirmStep({
  displayName,
  onConfirm,
  onReject,
  alreadyHere,
  recordHref,
}: {
  displayName: string;
  onConfirm: () => void;
  onReject: () => void;
  alreadyHere?: { connection: Connection; endedOn: string | null } | null;
  /** The candidate's edit page; used only when `alreadyHere`. */
  recordHref?: string;
}) {
  if (alreadyHere && recordHref) {
    return (
      <div className="space-y-4">
        <p className="text-lg font-medium">
          {displayName} is already in this community.
        </p>
        <p className="text-base">
          {alreadyHereSentence(alreadyHere.connection, alreadyHere.endedOn)}
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild className="min-h-[44px] w-full">
            <Link href={recordHref}>Open their record</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReject}
            className="min-h-[44px] w-full"
          >
            No, this is someone new
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-base">
        We found someone who might already be in the system:
      </p>
      <p className="text-lg font-medium">{displayName}</p>
      <p className="text-sm text-muted-foreground">
        Is this the same person you&apos;re adding?
      </p>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          onClick={onConfirm}
          className="min-h-[44px] w-full"
        >
          Yes, this is {displayName}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onReject}
          className="min-h-[44px] w-full"
        >
          No, this is someone new
        </Button>
      </div>
    </div>
  );
}
