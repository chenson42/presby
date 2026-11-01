"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatedText } from "@/components/shared/dated-text";
import { useHydrated } from "@/components/shared/use-hydrated";
import {
  alreadyHereSentence,
  type Connection,
} from "@/lib/community-labels";
import { RestoreDialog } from "../restore-dialog";

/**
 * Req 7 — the duplicate-match confirm screen. Plain language, two big
 * buttons, NO confidence score rendered anywhere — `displayName` is the
 * ONLY thing shown about the candidate, matching `matchPerson()`'s own
 * minimal-disclosure contract (`presby_match_person()` never returns a
 * birthdate or address pre-confirmation either).
 *
 * An ARCHIVED candidate (Increment 3a, Copy groups D and E) says when they were
 * archived and offers "Restore {name}" beside "Open their record"; the restore
 * dialog is the one the lists use, and on success the wizard takes the
 * administrator to the restored record (`onRestored`). The date in the sentence
 * goes through `<FormattedDate>`, never a hand-formatted string.
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
  restore,
}: {
  displayName: string;
  onConfirm: () => void;
  onReject: () => void;
  alreadyHere?: { connection: Connection; endedOn: string | null } | null;
  /** The candidate's edit page; used only when `alreadyHere`. */
  recordHref?: string;
  /** What Restore needs; offered only for an archived candidate. */
  restore?: {
    slug: string;
    personId: string;
    organization: string;
    onRestored: () => void;
  };
}) {
  if (alreadyHere && recordHref) {
    const archived =
      alreadyHere.connection === "former_visitor" || alreadyHere.connection === "archived";
    return (
      <div className="space-y-4">
        <p className="text-lg font-medium">
          {displayName} is already in this community.
        </p>
        <p className="text-base">
          <DatedText
            dates={alreadyHere.endedOn ? [alreadyHere.endedOn] : []}
            render={(date) => alreadyHereSentence(alreadyHere.connection, date ?? null)}
          />
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild className="min-h-[44px] w-full">
            <Link href={recordHref}>Open their record</Link>
          </Button>
          {archived && restore && (
            <RestoreFromWizard
              displayName={displayName}
              connection={alreadyHere.connection}
              {...restore}
            />
          )}
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

/**
 * The wizard's Restore button and its dialog. The sign-in fact is not read on
 * this screen, so the dialog omits its connected line (`signInConnected` null);
 * the list a person returns to comes from the connection (an archived visitor
 * returns to Visitors, anyone else to Inactive), the same rule the server uses.
 */
function RestoreFromWizard({
  displayName,
  connection,
  slug,
  personId,
  organization,
  onRestored,
}: {
  displayName: string;
  connection: Connection;
  slug: string;
  personId: string;
  organization: string;
  onRestored: () => void;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-[44px] w-full"
        disabled={!hydrated}
        onClick={() => setOpen(true)}
      >
        Restore {displayName}
      </Button>
      <RestoreDialog
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        personId={personId}
        personName={displayName}
        organization={organization}
        list={connection === "former_visitor" ? "Visitors" : "Inactive"}
        signInConnected={null}
        onRestored={onRestored}
      />
    </>
  );
}
