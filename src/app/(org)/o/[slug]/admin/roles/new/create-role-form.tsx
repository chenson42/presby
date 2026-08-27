"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type {
  PermissionCatalogEntry,
  TemplateRoleEntry,
} from "@/lib/role-definitions";
import { adoptTemplateAction, createRoleAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
 * The tier-grouped permission checklist — STACKED COLLAPSIBLE `<details>`
 * GROUPS, not a wide table or a flat multi-select (Phase 3 Edge Cases: a
 * real layout problem at 360px as the catalog grows, verified in a real
 * browser). Every group defaults `open` so the tier-3 boundary is visible
 * without an extra tap at creation time (Phase 1's own recommendation), and
 * can be collapsed once the list is long.
 *
 * NEVER SETS `display` ON THE `<summary>` ELEMENT ITSELF — CLAUDE.md's
 * "Verify in a Browser" invariant names exactly this defect (a `display`
 * override on `<summary>` silently breaks the native disclosure triangle on
 * iOS). The summary's own layout stays the browser default; only the nested
 * `<span>` carries spacing utility classes.
 */
function PermissionChecklist({
  catalog,
  selectedKeys,
  onToggle,
  readOnly,
}: {
  catalog: PermissionCatalogEntry[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  readOnly?: boolean;
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
                const inputId = `perm-${tier}-${entry.key}`;
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
                      disabled={readOnly}
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
 * Two independent flows, sharing the same tier-grouped checklist rendering
 * but each posting to a DIFFERENT server action (Phase 3 API contract):
 *
 *   1. "Create a custom role" — key + name + a freely-editable checklist ->
 *      `createRoleAction`. The subset check runs server-side against
 *      whatever the actor toggled.
 *   2. "Or adopt a template" (only rendered when `templates.length > 0`) —
 *      pick a template, preview ITS ACTUAL permission set (read-only,
 *      non-interactive checklist), optionally rename the org's own copy ->
 *      `adoptTemplateAction`. This is deliberately NOT the same submit path
 *      as (1): `adoptTemplate()` clones the template's exact current
 *      permission set server-side and does not accept a caller-supplied
 *      permission list, so the preview here is honest about what will
 *      actually be granted, not an editable draft of it.
 *
 * `escalation_denied` / `duplicate_key` / `invalid_input` surface via
 * `toast.error` with the SERVER's own message, same discipline as
 * `GrantRoleForm`.
 */
export function CreateRoleForm({
  slug,
  catalog,
  templates,
}: {
  slug: string;
  catalog: PermissionCatalogEntry[];
  templates: TemplateRoleEntry[];
}) {
  const router = useRouter();

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [templateName, setTemplateName] = useState(templates[0]?.name ?? "");
  const [adopting, setAdopting] = useState(false);

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — two independent forms on one
  // page (create / adopt-a-template), one guard: either draft counts as
  // "dirty." Neither form has its own in-form Back link — `page.tsx`'s
  // "Back to roles" link sits above both; the guard's document-level click
  // interception (see the hook's header) is what catches it.
  const selectedTemplateForDirty = templates.find((t) => t.id === templateId);
  const isDirty =
    key.trim() !== "" ||
    name.trim() !== "" ||
    selectedKeys.size > 0 ||
    templateKey.trim() !== (selectedTemplateForDirty?.key ?? "") ||
    templateName.trim() !== (selectedTemplateForDirty?.name ?? "");
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !name.trim()) {
      toast.error("Enter a key and a name.");
      return;
    }
    setCreating(true);
    const result = await createRoleAction(slug, {
      key: key.trim(),
      name: name.trim(),
      permissionKeys: [...selectedKeys],
    });
    setCreating(false);
    if (result.ok) {
      toast.success("Role created.");
      router.push(`/o/${slug}/admin/roles`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const selectedTemplate = templates.find((t) => t.id === templateId);

  async function handleAdopt(e: React.FormEvent) {
    e.preventDefault();
    if (!templateId) return;
    setAdopting(true);
    const result = await adoptTemplateAction(slug, {
      templateRoleId: templateId,
      key: templateKey.trim() ? templateKey.trim() : undefined,
      name: templateName.trim() ? templateName.trim() : undefined,
    });
    setAdopting(false);
    if (result.ok) {
      toast.success("Role adopted from template.");
      router.push(`/o/${slug}/admin/roles`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-10">
      <form onSubmit={handleCreate} className="space-y-4">
        <h2 className="text-lg font-semibold">Create a custom role</h2>

        <div>
          <Label htmlFor="role-key">Key</Label>
          <Input
            id="role-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="worship_committee"
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Lowercase letters, numbers, and underscores only, starting with a
            letter.
          </p>
        </div>

        <div>
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Worship Committee"
            className="mt-1"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Permissions</legend>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            You can only grant permissions you hold yourself.
          </p>
          <PermissionChecklist
            catalog={catalog}
            selectedKeys={selectedKeys}
            onToggle={toggleKey}
          />
        </fieldset>

        <Button type="submit" disabled={creating} className="min-h-11">
          {creating ? "Creating…" : "Create role"}
        </Button>
      </form>

      {templates.length > 0 && (
        <form
          onSubmit={handleAdopt}
          className="space-y-4 border-t border-border pt-8"
        >
          <h2 className="text-lg font-semibold">Or adopt a template</h2>
          <p className="text-sm text-muted-foreground">
            Clones a stock role and its permissions into this
            organization&apos;s own catalog. You can rename it below; its
            permission set matches the template exactly and can be edited
            afterward from the role catalog.
          </p>

          <div>
            <Label htmlFor="template-select">Template</Label>
            <div className="relative mt-1">
              <select
                id="template-select"
                value={templateId}
                onChange={(e) => {
                  const t = templates.find((tt) => tt.id === e.target.value);
                  setTemplateId(e.target.value);
                  setTemplateKey(t?.key ?? "");
                  setTemplateName(t?.name ?? "");
                }}
                className={SELECT_CLASSES}
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>

          <div>
            <Label htmlFor="template-key">Key</Label>
            <Input
              id="template-key"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="mt-1"
            />
          </div>

          {selectedTemplate && (
            <div>
              <p className="mb-1 text-sm font-medium">
                This template carries:
              </p>
              <PermissionChecklist
                catalog={catalog.filter((c) =>
                  selectedTemplate.permissionKeys.includes(c.key),
                )}
                selectedKeys={new Set(selectedTemplate.permissionKeys)}
                onToggle={() => {
                  /* read-only preview — see the module header. */
                }}
                readOnly
              />
            </div>
          )}

          <Button
            type="submit"
            variant="outline"
            disabled={adopting || !templateId}
            className="min-h-11"
          >
            {adopting ? "Adopting…" : "Adopt template"}
          </Button>
        </form>
      )}
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </div>
  );
}
