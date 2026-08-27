"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type {
  PermissionCatalogEntry,
  RoleDefinitionEntry,
} from "@/lib/role-definitions";
import { setRolePermissionsAction } from "./actions";

const TIER_LABELS: Record<number, string> = {
  1: "Tier 1 — Directory",
  2: "Tier 2 — Financial",
  3: "Tier 3 — Pastoral, demographic, and medical",
};

function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`;
}

function groupByTier(
  catalog: PermissionCatalogEntry[],
): Array<[number, PermissionCatalogEntry[]]> {
  const groups = new Map<number, PermissionCatalogEntry[]>();
  for (const entry of catalog) {
    const list = groups.get(entry.sensitivityTier) ?? [];
    list.push(entry);
    groups.set(entry.sensitivityTier, list);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Same tier-grouped, stacked-collapsible checklist as `new/create-role-
 * form.tsx`'s own `PermissionChecklist` — deliberately duplicated rather than
 * imported across the `new/`/`[id]/edit/` sibling boundary (Phase 3's
 * Component Plan names each file independently; a shared extraction wasn't
 * part of that plan, and this is a ~60-line, dependency-free render helper,
 * not a maintenance burden). NEVER sets `display` on `<summary>` itself — see
 * that file's identical header note.
 */
function PermissionChecklist({
  catalog,
  selectedKeys,
  onToggle,
}: {
  catalog: PermissionCatalogEntry[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const tiers = groupByTier(catalog);

  if (tiers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No permissions are in the catalog yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {tiers.map(([tier, entries]) => {
        const selectedCount = entries.filter((e) =>
          selectedKeys.has(e.key),
        ).length;
        return (
          <details
            key={tier}
            open
            className="rounded-lg border border-border"
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
              <span>{tierLabel(tier)}</span>{" "}
              <span className="font-normal text-muted-foreground">
                ({selectedCount}/{entries.length} selected)
              </span>
            </summary>
            <div className="space-y-1 border-t border-border px-4 py-3">
              {entries.map((entry) => {
                const inputId = `edit-perm-${tier}-${entry.key}`;
                return (
                  <label
                    key={entry.key}
                    htmlFor={inputId}
                    className="flex min-h-11 items-start gap-3 py-1.5 text-sm"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={selectedKeys.has(entry.key)}
                      onChange={() => onToggle(entry.key)}
                      className="mt-0.5 size-4 shrink-0 rounded border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    />
                    <span>
                      <span className="font-medium">{entry.key}</span>
                      <span className="block text-muted-foreground">
                        {entry.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/**
 * Edits an existing custom role's bound permission set. Key/name are NOT
 * editable here — `setRolePermissions()` has no such parameter (renaming a
 * role isn't in this pipeline's scope) — so they render as plain text, not
 * inputs.
 *
 * DISPLAYS `holderCount` FROM THE SERVER-FETCHED VALUE AT PAGE LOAD (Phase 3
 * Edge Cases): this is informational copy telling the admin who's affected,
 * not an access-control decision — the actual escalation/lockout
 * enforcement re-check happens server-side, fresh, inside
 * `setRolePermissionsAction` -> `setRolePermissions()`'s own transaction,
 * every time this form submits. This component never re-fetches it and never
 * implies the number is live-updating.
 */
export function EditRoleForm({
  slug,
  role,
  catalog,
}: {
  slug: string;
  role: RoleDefinitionEntry;
  catalog: PermissionCatalogEntry[];
}) {
  const router = useRouter();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(role.permissionKeys),
  );
  const [pending, setPending] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(
    new Set(role.permissionKeys),
  );

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — no in-form Back link;
  // `page.tsx`'s "Back to roles" link and the Danger-zone deactivate dialog
  // both sit above/below this form, and the guard's document-level click
  // interception (see the hook's header) catches the former without this
  // file needing to know it exists.
  const isDirty =
    selectedKeys.size !== savedKeys.size ||
    [...selectedKeys].some((k) => !savedKeys.has(k));
  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  function toggleKey(k: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await setRolePermissionsAction(slug, role.id, [
      ...selectedKeys,
    ]);
    setPending(false);
    if (result.ok) {
      toast.success("Role permissions updated.");
      setSavedKeys(new Set(selectedKeys));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <p className="text-sm font-medium">{role.name}</p>
        <p className="text-xs text-muted-foreground">Key: {role.key}</p>
      </div>

      <div
        role="status"
        className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        {role.holderCount === 0
          ? "Nobody currently holds this role."
          : role.holderCount === 1
            ? "1 person currently holds this role — this change takes effect for them immediately."
            : `${role.holderCount} people currently hold this role — this change takes effect for all of them immediately.`}
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Permissions</legend>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">
          You can only add permissions you hold yourself. Removing a
          permission never requires that check.
        </p>
        <PermissionChecklist
          catalog={catalog}
          selectedKeys={selectedKeys}
          onToggle={toggleKey}
        />
      </fieldset>

      <Button type="submit" disabled={pending} className="min-h-11">
        {pending ? "Saving…" : "Save changes"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
