"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrganizationType } from "@/lib/authz";
import {
  designateFoundingAdministratorAction,
  type PolicyResult,
} from "./actions";

/**
 * Human-friendly labels for the administration half of the founding-
 * administrator bundle (`foundingAdministratorPlan()`'s `permissionKeys`,
 * work-log Phase 2 Ruling 3). Kept here, not imported from
 * `@/lib/founding-administrator` — that module transitively imports
 * `@/lib/db`, whose module-scope pool construction throws without
 * `DATABASE_URL` (Batch B's own discovery, restated in its header comment);
 * a client component must not pull that module into the browser bundle.
 * `page.tsx` (a Server Component) is the one place that plan function is
 * ever called; this component receives only the plain data it needs
 * (`administrationPermissionKeys`, `officeTemplateName`) as props.
 */
const PERMISSION_LABELS: Record<string, string> = {
  "people.manage": "people",
  "roles.manage": "roles",
  "role_grants.manage": "role assignments",
  "groups.manage": "groups",
  "officers.manage": "officers",
  "org_features.manage": "feature toggles",
  "tickets.file": "support tickets",
  "staff.manage": "staff",
  "congregation_oversight.manage": "congregation oversight",
};

function summarizePermissions(keys: string[]): string {
  const labels = keys.map((key) => PERMISSION_LABELS[key] ?? key);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Simple client-side shape check only — the server action's zod schema
// (`z.string().trim().toLowerCase().email().max(320)`) is the actual gate.
// This exists only to keep the confirm dialog from opening on obvious
// garbage, not to replace server-side validation.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FoundingAdministratorSectionProps {
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  canDesignate: boolean;
  currentHolderCount: number;
  administrationPermissionKeys: string[];
  officeTemplateName: string | null;
}

/**
 * `/admin/organizations/<id>`'s founding-administrator section
 * (docs/work-log/2026-09-28-founding-administrator.md Phase 3, "Component /
 * Page Plan"). One email input, no person picker — the database chooses the
 * branch (Phase 2 Ruling 4). Structural match to `neutralize-dialog.tsx`
 * (AlertDialog confirm, called directly rather than via a raw form submit —
 * Workflow Rule 2, this act originates access) crossed with
 * `profile-form.tsx` (inline result banner, never toast-only feedback).
 *
 * `page.tsx` computes `canDesignate`/`currentHolderCount` fresh on every
 * render (never cached — `countFoundingAdministratorHolders()`'s own
 * discipline) and this component trusts those props for exactly one render;
 * a stale prop from a slow client only ever causes an extra round trip to
 * the server action, which re-checks the gate itself and returns
 * `has_holders` if it has gone stale — never a client-side-only guard.
 */
export function FoundingAdministratorSection({
  organizationId,
  organizationName,
  organizationType,
  canDesignate,
  currentHolderCount,
  administrationPermissionKeys,
  officeTemplateName,
}: FoundingAdministratorSectionProps) {
  const [email, setEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const emailLooksValid = EMAIL_SHAPE_RE.test(email.trim());

  // `organizationType` is accepted as a prop (and threaded through, per the
  // page-gate contract) but is not read directly here: the presbytery-only
  // `congregation_oversight.manage` clause is already folded into
  // `administrationPermissionKeys` by `foundingAdministratorPlan()` on the
  // server, so `permissionSummary` alone is correct for every org type
  // without a second branch in this component.
  void organizationType;
  const permissionSummary = summarizePermissions(administrationPermissionKeys);

  function handleConfirm() {
    const trimmedEmail = email.trim();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("email", trimmedEmail);
      const outcome = await designateFoundingAdministratorAction(fd);
      setResult(outcome);
      setConfirmOpen(false);
      if (outcome.ok) {
        toast.success(`${trimmedEmail} is now ${organizationName}'s founding administrator.`);
        setEmail("");
      } else {
        toast.error(outcome.error);
      }
    });
  }

  if (!canDesignate) {
    return (
      <section className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Founding administrator
        </h2>
        <p className="mt-1 text-sm text-foreground">
          This organization already has{" "}
          {currentHolderCount === 1
            ? "one person"
            : `${currentHolderCount} people`}{" "}
          who can manage roles — a founding administrator has already been
          designated. Grant or revoke roles from the organization&apos;s own
          Roles page instead.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-900 dark:bg-blue-950">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-200">
        Founding administrator
      </h2>
      <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-200/80">
        This organization has no one yet who can manage roles. Designate one
        person by email to hand it over — this can only be done once per
        organization (or again if it ever loses every role-manager).
      </p>

      {result && !result.ok && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {result.error}
        </div>
      )}
      {result && result.ok && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
        >
          Founding administrator designated.
        </div>
      )}

      <div className="mt-4 max-w-sm">
        <Label htmlFor="foundingAdministratorEmail">Email address</Label>
        <Input
          id="foundingAdministratorEmail"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="clerk@example.org"
          disabled={isPending}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          The person must sign up for a platform account first — they&apos;ll
          land on a page saying they have no organizations yet — then you
          designate them here by that same email address.
        </p>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Button
          type="button"
          className="mt-4 min-h-[44px]"
          disabled={!emailLooksValid || isPending}
          onClick={() => setConfirmOpen(true)}
        >
          {isPending ? "Designating…" : "Designate founding administrator"}
        </Button>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Designate {email.trim()} as {organizationName}&apos;s founding
              administrator?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be able to manage {permissionSummary}
              {officeTemplateName
                ? `, plus this organization's constitutional ${officeTemplateName} office`
                : ""}
              . This can only be done once — the organization&apos;s own
              administrators grant everyone after this through the ordinary
              Roles page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
              {isPending ? "Designating…" : "Yes, designate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
