"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { GrantFormOptions, RoleGrantee } from "@/lib/role-grants";
import { grantRoleAction } from "./actions";

type TargetKind = RoleGrantee["kind"];

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Grants an existing role to an existing person or group. No `Dialog`
 * primitive exists yet (Phase 3 design, out of scope this pipeline) — this
 * is an inline form, native `<select>`s per docs/ui-standards.md's Select &
 * Combobox Patterns section (there is no `Select`/`Command` primitive in
 * this repo today).
 *
 * NO WILDCARD TEMPLATE (Phase 1 finding 3): the role `<select>` renders
 * exactly `options.roles.length` entries — no "select all", no stock
 * "Church Administrator" pre-bound to the full catalog.
 *
 * `escalation_denied` / `forbidden` errors are surfaced via `toast.error`
 * with the SERVER's own message — never swallowed or replaced with a
 * generic string (Phase 3 acceptance criteria).
 */
export function GrantRoleForm({
  slug,
  options,
}: {
  slug: string;
  options: GrantFormOptions;
}) {
  const router = useRouter();
  const [targetKind, setTargetKind] = useState<TargetKind>("person");
  const [roleId, setRoleId] = useState(options.roles[0]?.id ?? "");
  const [personId, setPersonId] = useState(options.people[0]?.personId ?? "");
  const [groupId, setGroupId] = useState(options.groups[0]?.groupId ?? "");
  const [pending, setPending] = useState(false);

  if (options.roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No roles have been set up for this organization yet. Contact support
        to add one.
      </p>
    );
  }

  const targetListEmpty =
    targetKind === "person"
      ? options.people.length === 0
      : options.groups.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (targetListEmpty) return;

    setPending(true);
    const target: RoleGrantee =
      targetKind === "person" ? { kind: "person", personId } : { kind: "group", groupId };
    const result = await grantRoleAction(slug, { roleId, target });
    setPending(false);

    if (result.ok) {
      toast.success("Role granted.");
      // `grantRoleAction` already calls `revalidatePath()` server-side, which
      // marks the cache stale but does NOT re-render THIS already-mounted
      // page — confirmed live in a real-browser walkthrough (Verify in a
      // Browser): the table below stayed on its pre-grant snapshot without
      // this. `router.refresh()` re-fetches the current route's Server
      // Component payload so the new grant appears without a manual reload.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Grant to</legend>
        <div className="flex gap-4">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="targetKind"
              value="person"
              checked={targetKind === "person"}
              onChange={() => setTargetKind("person")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            A person
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="targetKind"
              value="group"
              checked={targetKind === "group"}
              onChange={() => setTargetKind("group")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            A group
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor="grant-role" className="block text-sm font-medium">
          Role
        </label>
        <div className="relative mt-1">
          <select
            id="grant-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className={SELECT_CLASSES}
          >
            {options.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      {targetKind === "person" ? (
        <div>
          <label htmlFor="grant-person" className="block text-sm font-medium">
            Person
          </label>
          {options.people.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Nobody has a current membership at this organization yet.
            </p>
          ) : (
            <div className="relative mt-1">
              <select
                id="grant-person"
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className={SELECT_CLASSES}
              >
                {options.people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor="grant-group" className="block text-sm font-medium">
            Group
          </label>
          {options.groups.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No groups exist at this organization yet.
            </p>
          ) : (
            <div className="relative mt-1">
              <select
                id="grant-group"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className={SELECT_CLASSES}
              >
                {options.groups.map((group) => (
                  <option key={group.groupId} value={group.groupId}>
                    {group.name}
                    {group.derived ? " (derived)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          )}
        </div>
      )}

      <Button
        type="submit"
        disabled={pending || targetListEmpty}
        className="min-h-11"
      >
        {pending ? "Granting…" : "Grant role"}
      </Button>
    </form>
  );
}
