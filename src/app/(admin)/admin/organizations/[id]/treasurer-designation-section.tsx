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
import { HydrationGate } from "@/components/shared/hydration-gate";
import { designateTreasurerAction, type PolicyResult } from "./actions";

// Client-side shape check only: the action's zod schema is the real gate. It
// only keeps the confirm dialog from opening on obvious garbage.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface TreasurerDesignationSectionProps {
  organizationId: string;
  organizationName: string;
  /** Read fresh on every render by `page.tsx` (never cached). */
  canDesignate: boolean;
  /** Number of people who currently hold `giving.manage`. A count, NEVER names:
   * who handles a congregation's money is not the platform operator's to read
   * off a list (the same discipline the founding-administrator section keeps). */
  currentHolderCount: number;
}

/**
 * `/admin/organizations/<id>`'s treasurer-designation section — the platform
 * operator names a congregation's FIRST holder of `giving.manage`
 * (docs/work-log/2026-10-15-online-giving.md, Phase 2 R2 / Phase 3
 * "Designation"; DECISION-155's shape, beside `founding-administrator-section`).
 *
 * `page.tsx` renders this ONLY for an applicable organization type
 * (congregation or new worshiping community) — a presbytery sees no section at
 * all. For an applicable org it shows the email control while the holder count
 * is zero and, once anyone holds `giving.manage`, collapses to a read-only
 * count with no form: the control "disappears once designated". This
 * component trusts its props for one render only; the server action re-checks
 * the gate itself and answers `has_holders` if the prop went stale — never a
 * client-side-only guard.
 *
 * Not a `useForm` root (plain controlled state + an AlertDialog confirm, the
 * founding-administrator section's structure), but wrapped in
 * `<HydrationGate>` all the same so nothing typed before hydration is lost.
 * The act grants access to money, so the confirm is an `AlertDialog`
 * (Workflow Rule 2), never a native dialog.
 */
export function TreasurerDesignationSection({
  organizationId,
  organizationName,
  canDesignate,
  currentHolderCount,
}: TreasurerDesignationSectionProps) {
  const [email, setEmail] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<PolicyResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const emailLooksValid = EMAIL_SHAPE_RE.test(email.trim());

  function handleConfirm() {
    const trimmedEmail = email.trim();
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("email", trimmedEmail);
      const outcome = await designateTreasurerAction(fd);
      setResult(outcome);
      setConfirmOpen(false);
      if (outcome.ok) {
        toast.success(`${trimmedEmail} is now ${organizationName}'s treasurer.`);
        setEmail("");
      } else {
        toast.error(outcome.error);
      }
    });
  }

  if (!canDesignate) {
    return (
      <section
        data-testid="treasurer-designation-section"
        className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Treasurer
        </h2>
        <p className="mt-1 text-sm text-foreground">
          This organization already has{" "}
          {currentHolderCount === 1
            ? "one person"
            : `${currentHolderCount} people`}{" "}
          who can manage giving — a treasurer has already been designated.
          They add and remove everyone else from the organization&apos;s own
          Giving team page.
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="treasurer-designation-section"
      className="mt-8 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 dark:border-blue-900 dark:bg-blue-950"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-200">
        Treasurer
      </h2>
      <p className="mt-1 text-sm text-blue-900/80 dark:text-blue-200/80">
        No one here can manage giving yet. Designate the congregation&apos;s
        first treasurer by email — this can only be done while nobody holds that
        access (it also works as a recovery if the last treasurer is ever
        removed).
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
          Treasurer designated.
        </div>
      )}

      <HydrationGate className="mt-4">
        <div className="max-w-sm">
          <Label htmlFor="treasurerEmail">Treasurer&apos;s email address</Label>
          <Input
            id="treasurerEmail"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="treasurer@example.org"
            disabled={isPending}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            The person must already be a member of this organization and have a
            platform account. Designation never adds anyone to the organization;
            if they are not a member yet, the organization&apos;s administrator
            enrols them first.
          </p>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button
            type="button"
            className="mt-4 min-h-[44px]"
            disabled={!emailLooksValid || isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {isPending ? "Designating…" : "Designate treasurer"}
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Designate {email.trim()} as {organizationName}&apos;s treasurer?
              </AlertDialogTitle>
              <AlertDialogDescription>
                They will be able to view every gift and donor, record gifts,
                and manage the organization&apos;s giving settings, funds and
                giving team. Holding this access requires two-factor sign-in.
                After this, the treasurer — not the platform — adds and removes
                everyone else.
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
      </HydrationGate>
    </section>
  );
}
