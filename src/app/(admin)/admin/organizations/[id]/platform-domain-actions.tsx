"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { ChecklistHost } from "@/lib/domains/checklist";
import {
  checkDomainPlatformAction,
  forceReleaseDomainAction,
  setDomainHoldAction,
  type PlatformDomainActionResult,
} from "./domains-actions";

/**
 * The platform admin's controls for ONE host: Check now, Pause / Resume,
 * Dispute / Clear dispute, Force-release (Flow 7, G3, G31). Every destructive or
 * state-changing control is an `AlertDialog` that names the organization and the
 * host and, where the action needs one, takes a required reason (10-500
 * characters; recorded, audited, and shown to the organization's administrators).
 * No native dialogs. Plain onClick controls are disabled until hydrated.
 */

const REASON_MIN = 10;
const REASON_MAX = 500;

function ReasonDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  withCause = false,
  onSubmit,
  hostLabel,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  withCause?: boolean;
  onSubmit: (reason: string, cause: "force_released" | "evicted") => Promise<PlatformDomainActionResult<unknown>>;
  hostLabel: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [cause, setCause] = useState<"force_released" | "evicted">("force_released");
  const [pending, setPending] = useState(false);
  const length = reason.trim().length;
  const valid = length >= REASON_MIN && length <= REASON_MAX;
  const fieldId = `reason-${hostLabel}-${triggerLabel}`.replace(/[^a-z0-9-]/gi, "-");

  async function confirm() {
    setPending(true);
    try {
      const result = await onSubmit(reason.trim(), cause);
      if (result.ok) {
        toast.success(`${confirmLabel}: done.`);
        setOpen(false);
        setReason("");
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("That didn't go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={destructive ? "destructive" : "outline"}
          size="sm"
          className="min-h-11"
          disabled={!hydrated}
          aria-label={`${triggerLabel} ${hostLabel}`}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {withCause && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Why is it being released?</legend>
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
              <input
                type="radio"
                name={`${fieldId}-cause`}
                checked={cause === "force_released"}
                onChange={() => setCause("force_released")}
                className="size-4"
              />
              <span className="text-base">Released by support</span>
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
              <input
                type="radio"
                name={`${fieldId}-cause`}
                checked={cause === "evicted"}
                onChange={() => setCause("evicted")}
                className="size-4"
              />
              <span className="text-base">Evicted (a dispute was decided against this organization)</span>
            </label>
          </fieldset>
        )}
        <div>
          <Label htmlFor={fieldId}>Reason ({REASON_MIN} to {REASON_MAX} characters)</Label>
          <Textarea
            id={fieldId}
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={`${fieldId}-hint`}
            className="mt-1"
          />
          <p id={`${fieldId}-hint`} className="mt-1 text-sm text-muted-foreground">
            Recorded in the audit log and shown to the organization&apos;s administrators. {length}/{REASON_MAX}.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="min-h-11"
            disabled={!valid || pending}
            onClick={confirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResumeDialog({
  hold,
  hostLabel,
  domainId,
}: {
  hold: "paused" | "disputed";
  hostLabel: string;
  domainId: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const label = hold === "paused" ? "Resume" : "Clear dispute";

  async function confirm() {
    setPending(true);
    try {
      const result = await setDomainHoldAction(domainId, null, null);
      if (result.ok) {
        toast.success(`${hostLabel} is no longer ${hold === "paused" ? "paused" : "under dispute"}.`);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("That didn't go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          disabled={!hydrated}
          aria-label={`${label} ${hostLabel}`}
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {label} {hostLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The host goes back to serving as soon as its checks are healthy. The organization&apos;s administrators are
            told.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" className="min-h-11" disabled={pending} onClick={confirm}>
            {pending ? "Working…" : label}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PlatformDomainActions({
  host,
  organizationName,
}: {
  host: Pick<ChecklistHost, "id" | "displayHostname" | "hold" | "state">;
  organizationName: string;
}) {
  const hydrated = useHydrated();
  const [checking, startCheck] = useTransition();
  const hostLabel = host.displayHostname;

  function check() {
    startCheck(async () => {
      try {
        const result = await checkDomainPlatformAction(host.id);
        if (result.ok) toast.success(`Checked ${hostLabel}: ${result.data!.outcome.replace(/_/g, " ")}.`);
        else toast.error(result.error);
      } catch {
        toast.error("That didn't go through. Try again.");
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2" data-testid={`platform-actions-${host.displayHostname}`}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11"
        disabled={!hydrated || checking}
        onClick={check}
        aria-label={`Check now ${hostLabel}`}
      >
        {checking ? "Checking…" : "Check now"}
      </Button>

      {host.hold === null ? (
        <>
          <ReasonDialog
            hostLabel={hostLabel}
            triggerLabel="Pause"
            title={`Pause ${hostLabel}?`}
            description={`${hostLabel} stops serving at once, and a visitor sees the same page-not-found as any unknown address. ${organizationName}'s site stays available at its PresbyPortal address. No DNS changes are needed to undo it.`}
            confirmLabel="Pause"
            pendingLabel="Pausing…"
            onSubmit={(reason) => setDomainHoldAction(host.id, "paused", reason)}
          />
          <ReasonDialog
            hostLabel={hostLabel}
            triggerLabel="Dispute"
            title={`Mark ${hostLabel} as disputed?`}
            description={`${hostLabel} stops serving while the dispute is reviewed. Resolve it by clearing the dispute, or by force-releasing the host.`}
            confirmLabel="Mark disputed"
            pendingLabel="Saving…"
            onSubmit={(reason) => setDomainHoldAction(host.id, "disputed", reason)}
          />
        </>
      ) : (
        <ResumeDialog hold={host.hold} hostLabel={hostLabel} domainId={host.id} />
      )}

      {host.state !== "release_pending" && (
        <ReasonDialog
          hostLabel={hostLabel}
          triggerLabel="Force-release"
          title={`Force-release ${hostLabel}?`}
          description={`${hostLabel} is released from ${organizationName} now, skipping the 30-day hold, and detached from hosting. The name becomes available to others. ${organizationName}'s administrators are told, with your reason.`}
          confirmLabel="Force-release"
          pendingLabel="Releasing…"
          destructive
          withCause
          onSubmit={(reason, cause) => forceReleaseDomainAction(host.id, { reason, cause })}
        />
      )}
    </div>
  );
}
