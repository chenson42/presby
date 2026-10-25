"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UNDO_WINDOW_MS } from "@/lib/parishes-pure";
import { moveHouseholdAction } from "./[orgUnitId]/actions";
import { assignHouseholdAction } from "./unassigned/actions";
import { movedToastCopy } from "./parish-copy";

const SELECT_CLASSES =
  "min-h-11 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

/** The "Remove from district" option's value - never a uuid. */
const CLEAR_VALUE = "__none__";

type Target = { orgUnitId: string; name: string };

/**
 * The per-household district picker: a native `<select>` plus an EXPLICIT
 * Move (district page) or Assign (Unassigned page) button
 * (docs/work-log/2026-10-25-parish-management.md, Phase 3 P3-1; F261).
 *
 * IT NEVER COMMITS ON SELECTION. Arrow keys on a closed `<select>` fire `change`
 * once per keypress in Chrome and Firefox on Windows, so a keyboard user would
 * write one move (and one audit row) per keypress. This component has no
 * `onChange` handler at all (`parishes-boundaries.test.ts` scans for one); the
 * select is UNCONTROLLED and read through a ref when the button is clicked. The
 * pair sits inside `<HydrationGate>` (DECISION-159): nothing can be picked or
 * pressed before the page's JavaScript has run, so a pre-hydration pick cannot be
 * lost to a default (there is no `useForm` here, but the same divergence applies
 * to a `<select>` the framework has not adopted yet).
 *
 * Each write carries the district the viewer SAW (`expectedOrgUnitId`) so the
 * server can answer a conflict instead of overwriting. A success shows a toast
 * with Undo for `UNDO_WINDOW_MS`; Undo is the same call with expected and target
 * swapped, and the server refuses it truthfully if the previous district has
 * since been archived. A refused or failed row stays, with an inline error and
 * its own in-flight state; the page is refreshed when its data may be stale.
 */
export function RowAssign({
  slug,
  mode,
  householdId,
  householdName,
  currentOrgUnitId,
  targets,
}: {
  slug: string;
  mode: "move" | "assign";
  householdId: string;
  householdName: string;
  /** The district the viewer sees this household in; `null` when it has none. */
  currentOrgUnitId: string | null;
  /** Active districts only, the current one already excluded. */
  targets: Target[];
}) {
  const router = useRouter();
  const selectRef = useRef<HTMLSelectElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = mode === "move" ? moveHouseholdAction : assignHouseholdAction;
  const selectId = `row-assign-${householdId}`;
  const label = mode === "move" ? "Move to" : "Assign to";
  const buttonLabel = mode === "move" ? "Move" : "Assign";

  async function submit() {
    const value = selectRef.current?.value ?? "";
    if (value === "") {
      setError("Choose a district first.");
      return;
    }
    const targetOrgUnitId = value === CLEAR_VALUE ? null : value;

    setPending(true);
    setError(null);
    try {
      const result = await act(slug, {
        householdId,
        expectedOrgUnitId: currentOrgUnitId,
        targetOrgUnitId,
      });
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      const change = result.data;
      if (change && change.changed) {
        const previous = change.fromOrgUnitId;
        const next = change.toOrgUnitId;
        toast.success(movedToastCopy(mode, change), {
          duration: UNDO_WINDOW_MS,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                const undone = await act(slug, {
                  householdId,
                  expectedOrgUnitId: next,
                  targetOrgUnitId: previous,
                  undo: true,
                });
                if (undone.ok) toast.success("Undone.");
                else toast.error(undone.error);
              } catch {
                toast.error("Could not undo. Nothing was changed.");
              }
              router.refresh();
            },
          },
        });
      }
      if (selectRef.current) selectRef.current.value = "";
      router.refresh();
    } catch {
      setError("Could not move the household. Nothing was changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <HydrationGate>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor={selectId}>
            {label}
            <span className="sr-only"> for {householdName}</span>
          </Label>
          <div className="relative mt-1">
            <select
              id={selectId}
              ref={selectRef}
              defaultValue=""
              disabled={pending}
              aria-describedby={error ? `${selectId}-error` : undefined}
              className={SELECT_CLASSES}
            >
              <option value="">Choose a district…</option>
              {mode === "move" ? (
                <option value={CLEAR_VALUE}>Remove from district</option>
              ) : null}
              {targets.map((target) => (
                <option key={target.orgUnitId} value={target.orgUnitId}>
                  {target.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
        </div>
        <Button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          disabled={pending}
          onClick={submit}
          aria-label={`${buttonLabel} ${householdName}`}
        >
          {pending ? (mode === "move" ? "Moving…" : "Assigning…") : buttonLabel}
        </Button>
      </div>
      {error ? (
        <p id={`${selectId}-error`} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </HydrationGate>
  );
}
