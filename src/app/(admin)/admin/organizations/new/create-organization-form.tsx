"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  organizationTypeLabel,
  RELATIONSHIP_BY_CHILD_TYPE,
} from "@/lib/org-display";
import type { OrganizationType, PlatformStatus } from "@/lib/authz";
import type { RelationshipType } from "@/lib/db/domain/lifecycle";
import { createOrganizationAction, type CreateOrgPolicyResult } from "./actions";

const ORG_TYPES: readonly OrganizationType[] = [
  "congregation",
  "presbytery",
  "synod",
  "general_assembly",
  "new_worshiping_community",
];

const PLATFORM_STATUSES: readonly PlatformStatus[] = [
  "managed",
  "unmanaged",
  "invited",
];

export type EligibleParent = { id: string; name: string };
type ParentType = "presbytery" | "synod" | "general_assembly";
/**
 * `null` = the eligible-parents fetch itself failed (the form degrades, it
 * does not break); an empty array = a legitimate empty state.
 */
export type EligibleParentsByType = Record<ParentType, EligibleParent[]> | null;

// The reverse of `presby_assert_council_authority()`'s pairing table
// (drizzle/0044). A COURTESY filter only: the server-side trigger/FK
// rejection (`invalid_parent`) stays the enforcement boundary.
const PARENT_TYPE_BY_CHILD: Partial<Record<OrganizationType, ParentType>> = {
  congregation: "presbytery",
  new_worshiping_community: "presbytery",
  presbytery: "synod",
  synod: "general_assembly",
  // general_assembly: absent — nothing is ever its parent.
};
const PARENT_TYPE_PLURAL: Record<ParentType, string> = {
  presbytery: "presbyteries",
  synod: "synods",
  general_assembly: "General Assembly organizations",
};

const SELECT_CLASS =
  "h-11 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

async function submitCreate(
  _prev: CreateOrgPolicyResult | null,
  formData: FormData,
): Promise<CreateOrgPolicyResult> {
  return createOrganizationAction(formData);
}

export function CreateOrganizationForm({
  eligibleParents,
}: {
  eligibleParents: EligibleParentsByType;
}) {
  const router = useRouter();
  const [organizationType, setOrganizationType] =
    useState<OrganizationType>("congregation");
  // "none" (never "") is the no-parent sentinel — a native <select> treats an
  // empty-string option like no value at all. It is translated to "" in the
  // hidden fields below, never submitted as-is.
  const [parentChoice, setParentChoice] = useState("none");
  const allowedParentType = PARENT_TYPE_BY_CHILD[organizationType];
  const hasParent = allowedParentType !== undefined && parentChoice !== "none";
  const [result, formAction, isPending] = useActionState(
    submitCreate,
    null as CreateOrgPolicyResult | null,
  );

  // The first action on this surface that navigates to a page that didn't
  // exist before submission — `router.push()` client-side rather than
  // `redirect()` inside the server action (Phase 3 ruling: every sibling
  // action on this surface already returns `{ ok }` and lets the caller
  // decide, and `redirect()`'s NEXT_REDIRECT throw is awkward to assert in a
  // Vitest unit test).
  useEffect(() => {
    if (result?.ok) {
      toast.success("Organization created.");
      router.push(`/admin/organizations/${result.organizationId}`);
    } else if (result && !result.ok) {
      toast.error(result.error);
    }
  }, [result, router]);

  return (
    <form action={formAction} className="space-y-6">
      {result && !result.ok && (
        <div
          role="status"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {result.error}
        </div>
      )}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="First Presbyterian Church of Anytown"
          className="mt-1"
        />
      </div>

      <div>
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          type="text"
          required
          placeholder="first-pres-anytown"
          className="mt-1 font-mono"
          aria-describedby="slugHelp"
        />
        <p
          id="slugHelp"
          className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          This cannot be changed once the organization is created.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Lowercase letters, numbers, and hyphens only; must start and end
          with a letter or number (max 63 characters) — for example, fpcw or
          first-pres-anytown.
        </p>
      </div>

      <div>
        <Label htmlFor="organizationType">Organization type</Label>
        <div className="relative mt-1">
          <select
            id="organizationType"
            name="organizationType"
            value={organizationType}
            onChange={(e) => {
              setOrganizationType(e.target.value as OrganizationType);
              // Always clear — never carry a stale parent id across a type
              // the admin did not mean to keep it for.
              setParentChoice("none");
            }}
            className={SELECT_CLASS}
          >
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>
                {organizationTypeLabel(t)}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      <input
        type="hidden"
        name="parentOrganizationId"
        value={hasParent ? parentChoice : ""}
      />
      <input
        type="hidden"
        name="relationshipType"
        value={hasParent ? (RELATIONSHIP_BY_CHILD_TYPE[organizationType] ?? "") : ""}
      />

      {allowedParentType === undefined ? (
        <p className="text-sm text-muted-foreground">
          The General Assembly is the top of the hierarchy — it has no parent.
        </p>
      ) : (
        <div>
          <Label htmlFor="parentOrganizationChoice">Parent organization</Label>
          <div className="relative mt-1">
            <select
              id="parentOrganizationChoice"
              name="parentOrganizationChoice"
              value={parentChoice}
              onChange={(e) => setParentChoice(e.target.value)}
              aria-describedby="parentHelp"
              className={SELECT_CLASS}
            >
              <option value="none">None — this will be a root organization</option>
              {(eligibleParents?.[allowedParentType] ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          <p id="parentHelp" className="mt-1.5 text-xs text-muted-foreground">
            {eligibleParents === null
              ? `We couldn't load the list of ${PARENT_TYPE_PLURAL[allowedParentType]} — try again.`
              : eligibleParents[allowedParentType].length === 0
                ? `No ${PARENT_TYPE_PLURAL[allowedParentType]} exist yet — create one first.`
                : "Optional. Leave as None for an independent organization."}
          </p>
        </div>
      )}

      {hasParent && (
        <div>
          <Label htmlFor="minuteReference">Minute reference (optional)</Label>
          <Input
            id="minuteReference"
            name="minuteReference"
            type="text"
            maxLength={500}
            className="mt-1 h-11"
            aria-describedby="minuteHelp"
          />
          <p id="minuteHelp" className="mt-1.5 text-xs text-muted-foreground">
            If provided, this affiliation is recorded as minuted rather than
            backfilled.
          </p>
        </div>
      )}

      <div>
        <Label htmlFor="platformStatus">Platform status</Label>
        <div className="relative mt-1">
          <select
            id="platformStatus"
            name="platformStatus"
            defaultValue="managed"
            className={SELECT_CLASS}
          >
            {PLATFORM_STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Managed: a real tenant. Unmanaged: in the hierarchy, records
          stewarded by a parent council. Invited: onboarding, pending
          handover.
        </p>
      </div>

      <Button type="submit" disabled={isPending} className="h-11">
        {isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
