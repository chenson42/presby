"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Field, FormError, SELECT_CLASSES, SelectBox } from "@/components/worship/form-bits";
import { ACTION_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import type { AdoptableGroup } from "@/lib/worship/reads";
import { adoptTeamAction } from "../../actions";

/** "Or use a group you already have" (Copy G3): shown only to a viewer who also holds `groups.manage`. */
export function ExistingGroupForm({ slug, groups }: { slug: string; groups: AdoptableGroup[] }) {
  const router = useRouter();
  const [groupId, setGroupId] = useState(groups[0]?.groupId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !groupId) return;
    setPending(true);
    setError(null);
    try {
      const result = await adoptTeamAction(slug, { groupId });
      if (result.ok) {
        toast.success(TEAMS_COPY.form.existingToast);
        router.push(`/o/${slug}/admin/worship/teams/${groupId}`);
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={onSubmit} className="space-y-4 border-t border-border pt-6" data-testid="existing-group-form">
        <Field id="existing-group" label={TEAMS_COPY.form.existingLabel}>
          <SelectBox>
            <select id="existing-group" className={SELECT_CLASSES} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name}
                </option>
              ))}
            </select>
          </SelectBox>
        </Field>
        <FormError message={error} />
        <Button type="submit" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending}>
          {pending ? NAV_COPY.saving : TEAMS_COPY.form.existingSubmit}
        </Button>
      </form>
    </HydrationGate>
  );
}
