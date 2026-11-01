"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useHydrated } from "@/components/shared/use-hydrated";
import { COPY } from "@/lib/reimbursement/copy";
import type { ReimbursementSettings } from "@/lib/reimbursement/detail-shape";
import { setChargeableAction } from "../actions";
import { approverNote } from "./approver-note";

/**
 * `Groups that can receive requests` (Copy C9): one card per group with the
 * `Can receive requests` switch and the live count of chairs or leaders who can
 * approve, or the plain note that requests for it go to the treasurer.
 *
 * The switch is a Radix `role="switch"` button, disabled until the page has
 * hydrated (a tap before then would do nothing and look like it had done
 * something; DECISION-159's rule for a control that is not a `useForm` root). It
 * flips at once and is put back, with the action's sentence in a toast, if the
 * save is refused or throws. There is no success toast: Copy gives none (the
 * change shows in place). Un-listing a group never touches requests already in
 * it. Each switch is inside a 44 px label row.
 */

type GroupRow = ReimbursementSettings["groups"][number];

export function ChargeableGroups({ slug, groups }: { slug: string; groups: GroupRow[] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  async function flip(group: GroupRow, next: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(group.id);
    setOverrides((current) => ({ ...current, [group.id]: next }));
    const revert = () =>
      setOverrides((current) => {
        const { [group.id]: _dropped, ...rest } = current;
        void _dropped;
        return rest;
      });
    try {
      const result = await setChargeableAction(slug, { groupId: group.id, chargeable: next });
      if (result.ok) {
        // The server's answer is now the page's data; drop the local copy once it has re-read.
        router.refresh();
        return;
      }
      revert();
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      toast.error(result.error);
    } catch {
      revert();
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <ul className="space-y-3" data-testid="chargeable-groups">
      {groups.map((group) => {
        const checked = overrides[group.id] ?? group.chargeable;
        const switchId = `chargeable-${group.id}`;
        return (
          <li key={group.id} className="rounded-lg border border-border bg-card p-4" data-testid="chargeable-row">
            <p className="text-base font-medium [overflow-wrap:anywhere]">{group.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{approverNote(group)}</p>
            <div className="mt-2 flex min-h-11 items-center gap-3">
              <Switch
                id={switchId}
                checked={checked}
                disabled={!hydrated || pending !== null}
                onCheckedChange={(next) => void flip(group, next)}
                aria-labelledby={`${switchId}-label`}
              />
              <label id={`${switchId}-label`} htmlFor={switchId} className="text-base">
                {COPY.settings.chargeableSwitch}
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
