"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import { keyLabelsFor } from "@/lib/reimbursement/key-labels";

/**
 * `Set up the Treasurer role` / `Set up the Reimbursement Clerk role` (Copy C9):
 * restores (or creates) the church's own copy of a role from its template so the
 * team page never strands. Shown only for a template with no assignable role. The
 * clerk's one-line description sits under its button. A role set up without some
 * keys (the viewer does not hold them) says which, by label (`COPY.team.keyLabels`), never raw keys. Disabled until hydration.
 */

export interface SetupItem {
  key: string;
  label: string;
  /** Under the button, when Copy gives the role a description. */
  description?: string;
}

export function TeamSetupButtons({
  items,
  ensure,
}: {
  items: SetupItem[];
  ensure: (input: { templateKey: string }) => Promise<ReimbursementActionResult<{ roleId: string; skippedKeys: string[] }>>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState<string | null>(null);
  const busy = useRef(false);

  async function setUp(templateKey: string) {
    if (busy.current) return;
    busy.current = true;
    setPending(templateKey);
    try {
      const result = await ensure({ templateKey });
      if (result.ok) {
        const skipped = keyLabelsFor(result.data.skippedKeys);
        toast.success(
          skipped.length > 0
            ? COPY.team.panel.roleSetUpWithout(skipped.join(", "), skipped.length > 1)
            : COPY.team.panel.roleSetUp,
        );
        router.refresh();
      } else if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  return (
    <ul className="space-y-3" data-testid="team-setup">
      {items.map((item) => (
        <li key={item.key}>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated || pending !== null}
            onClick={() => void setUp(item.key)}
            data-testid={`team-setup-${item.key}`}
          >
            {pending === item.key ? COPY.team.panel.settingUp : item.label}
          </Button>
          {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
        </li>
      ))}
    </ul>
  );
}
