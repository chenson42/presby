"use client";

import { Button } from "@/components/ui/button";

/**
 * Req 7 — the duplicate-match confirm screen. Plain language, two big
 * buttons, NO confidence score rendered anywhere — `displayName` is the
 * ONLY thing shown about the candidate, matching `matchPerson()`'s own
 * minimal-disclosure contract (`presby_match_person()` never returns a
 * birthdate or address pre-confirmation either).
 */
export function ConfirmStep({
  displayName,
  onConfirm,
  onReject,
}: {
  displayName: string;
  onConfirm: () => void;
  onReject: () => void;
}) {
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
