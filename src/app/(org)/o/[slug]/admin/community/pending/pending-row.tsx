"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormattedDate } from "@/components/shared/formatted-date";
import { useHydrated } from "@/components/shared/use-hydrated";
import { ROLL_ACTION_KIND_LABELS } from "@/lib/roll-action-kinds";
import type { PendingQueueViewer, PendingRollAction } from "@/lib/roll";
import { WithdrawProposalDialog } from "../withdraw-proposal-dialog";
import { ApproveRollActionDialog } from "./approve-roll-action-dialog";
import { DenyRollActionDialog } from "./deny-roll-action-dialog";

/**
 * One waiting roll action. Decide mode adds a select checkbox (a 44px target,
 * disabled until hydration) and Approve and Deny; read mode shows neither.
 * Withdraw appears for any `roll.propose` holder. Badges: "You proposed this"
 * (self-approval is permitted and surfaced, DECISION-205), "Connection ended"
 * and "Recorded as deceased" (approval would be refused, so the row can only be
 * denied or withdrawn), and "Takes effect {date}" for a future-dated row.
 */
export function PendingRow({
  slug,
  action,
  mode,
  viewer,
  today,
  selectable,
  selected,
  onToggle,
}: {
  slug: string;
  action: PendingRollAction;
  mode: "decide" | "read";
  viewer: PendingQueueViewer;
  today: string;
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const hydrated = useHydrated();
  const futureDated = action.effectiveDate > today;
  const checkboxId = `select-${action.id}`;

  return (
    <Card className="py-4" data-testid="pending-row">
      <CardContent className="space-y-3">
        <div className="flex items-start gap-1">
          {mode === "decide" && (
            <label
              htmlFor={checkboxId}
              className="-ml-2 -mt-2 flex size-11 shrink-0 cursor-pointer items-center justify-center"
            >
              <input
                id={checkboxId}
                type="checkbox"
                className="size-5 accent-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                checked={selected}
                disabled={!hydrated || !selectable}
                onChange={() => onToggle(action.id)}
                aria-label={
                  selectable
                    ? `Select ${action.personDisplayName}`
                    : `${action.personDisplayName} can't be approved, so can't be selected`
                }
              />
            </label>
          )}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-lg font-medium">
                {viewer.canManagePeople ? (
                  <Link
                    href={`/o/${slug}/admin/community/${action.personId}/edit`}
                    className="underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {action.personDisplayName}
                  </Link>
                ) : (
                  action.personDisplayName
                )}
              </h3>
              {action.proposedByIsViewer && (
                <Badge variant="outline" className="font-normal">
                  You proposed this
                </Badge>
              )}
              {action.membershipEnded && (
                <Badge variant="outline" className="font-normal">
                  Connection ended
                </Badge>
              )}
              {action.personDeceased && (
                <Badge variant="outline" className="font-normal">
                  Recorded as deceased
                </Badge>
              )}
              {futureDated && (
                <Badge variant="outline" className="font-normal">
                  Takes effect <FormattedDate value={action.effectiveDate} mode="date" />
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {ROLL_ACTION_KIND_LABELS[action.kind]}, effective{" "}
              <FormattedDate value={action.effectiveDate} mode="date" />
              {" · "}Proposed <FormattedDate value={action.proposedOn} mode="date" />
              {action.minuteReference ? ` · ${action.minuteReference}` : ""}
            </p>
          </div>
        </div>

        {(mode === "decide" || viewer.canPropose) && (
          <div className="flex flex-wrap gap-3">
            {mode === "decide" && (
              <>
                <ApproveRollActionDialog slug={slug} action={action} />
                <DenyRollActionDialog slug={slug} action={action} />
              </>
            )}
            {viewer.canPropose && (
              <WithdrawProposalDialog
                slug={slug}
                rollActionId={action.id}
                personName={action.personDisplayName}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
