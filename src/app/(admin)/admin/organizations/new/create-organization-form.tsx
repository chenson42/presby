"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { organizationTypeLabel } from "@/lib/org-display";
import type { OrganizationType, PlatformStatus } from "@/lib/authz";
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

async function submitCreate(
  _prev: CreateOrgPolicyResult | null,
  formData: FormData,
): Promise<CreateOrgPolicyResult> {
  return createOrganizationAction(formData);
}

export function CreateOrganizationForm() {
  const router = useRouter();
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
            defaultValue="congregation"
            className="h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

      <div>
        <Label htmlFor="platformStatus">Platform status</Label>
        <div className="relative mt-1">
          <select
            id="platformStatus"
            name="platformStatus"
            defaultValue="managed"
            className="h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
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

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
