"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { useHydrated } from "@/components/shared/use-hydrated";
import {
  DISTRICT_NAME_MAX,
  districtNameFormSchema,
  type DistrictNameFormValues,
} from "@/lib/parishes-pure";
import {
  archiveDistrictAction,
  renameDistrictAction,
  restoreDistrictAction,
} from "./actions";
import { archiveBodyCopy, archiveDeaconCopy } from "./parish-copy";

/**
 * The per-district controls on the Parishes page (copy C2), shown only to a
 * viewer who can define districts (`officers.manage`; the actions re-verify):
 *   - Rename: a `Dialog` holding a gated `useForm`;
 *   - Archive: an `AlertDialog` that states how many households are still in
 *     the district and whether a deacon term is still open;
 *   - Restore: one tap, for an archived district.
 * Every trigger is disabled until the page has hydrated (`useHydrated`,
 * DECISION-159) - a control that does nothing is not offered as operable. No
 * native dialog anywhere (Workflow Rule 2). Each failure is the action's mapped
 * copy, verbatim, via `toast.error`; the list is refreshed when the data it
 * rendered may be stale.
 */
export function DistrictCardControls({
  slug,
  orgUnitId,
  name,
  archived,
  householdCount,
  deaconName,
}: {
  slug: string;
  orgUnitId: string;
  name: string;
  archived: boolean;
  householdCount: number;
  deaconName: string | null;
}) {
  return archived ? (
    <RestoreButton slug={slug} orgUnitId={orgUnitId} name={name} />
  ) : (
    <div className="flex flex-col gap-2 sm:flex-row">
      <RenameDialog slug={slug} orgUnitId={orgUnitId} name={name} />
      <ArchiveDialog
        slug={slug}
        orgUnitId={orgUnitId}
        name={name}
        householdCount={householdCount}
        deaconName={deaconName}
      />
    </div>
  );
}

function RestoreButton({
  slug,
  orgUnitId,
  name,
}: {
  slug: string;
  orgUnitId: string;
  name: string;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function restore() {
    setPending(true);
    try {
      const result = await restoreDistrictAction(slug, { orgUnitId });
      if (result.ok) {
        toast.success(`${name} restored.`);
      } else {
        toast.error(result.error);
      }
      router.refresh();
    } catch {
      toast.error("We couldn't save that. Nothing was changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-11 w-full sm:w-auto"
      disabled={!hydrated || pending}
      aria-label={`Restore ${name}`}
      onClick={restore}
    >
      {pending ? "Restoring…" : "Restore"}
    </Button>
  );
}

function RenameDialog({
  slug,
  orgUnitId,
  name,
}: {
  slug: string;
  orgUnitId: string;
  name: string;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated}
          aria-label={`Rename ${name}`}
        >
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rename district</DialogTitle>
          <DialogDescription className="break-words">
            Currently {name}.
          </DialogDescription>
        </DialogHeader>
        <RenameForm
          slug={slug}
          orgUnitId={orgUnitId}
          name={name}
          onDone={() => setOpen(false)}
          footer={(submitting) => (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={submitting}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={submitting}>
                {submitting ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  slug,
  orgUnitId,
  name,
  onDone,
  footer,
}: {
  slug: string;
  orgUnitId: string;
  name: string;
  onDone: () => void;
  footer: (submitting: boolean) => React.ReactNode;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<DistrictNameFormValues>({
    resolver: zodResolver(districtNameFormSchema),
    defaultValues: { name },
  });
  const {
    register,
    formState: { errors },
  } = form;
  const inputId = `rename-district-${orgUnitId}`;

  async function onSubmit(values: DistrictNameFormValues) {
    setSubmitting(true);
    try {
      const result = await renameDistrictAction(slug, { orgUnitId, name: values.name });
      if (result.ok) {
        toast.success("District renamed.");
        onDone();
        router.refresh();
      } else {
        form.setError("name", { message: result.error });
      }
    } catch {
      form.setError("name", { message: "We couldn't save that. Nothing was changed." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <Label htmlFor={inputId}>District name</Label>
          <Input
            id={inputId}
            type="text"
            autoComplete="off"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? `${inputId}-error` : `${inputId}-help`}
            className="mt-1"
            {...register("name")}
          />
          {errors.name ? (
            <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm text-destructive">
              {errors.name.message}
            </p>
          ) : (
            <p id={`${inputId}-help`} className="mt-1 text-sm text-muted-foreground">
              Up to {DISTRICT_NAME_MAX} characters.
            </p>
          )}
        </div>
        {footer(submitting)}
      </form>
    </HydrationGate>
  );
}

function ArchiveDialog({
  slug,
  orgUnitId,
  name,
  householdCount,
  deaconName,
}: {
  slug: string;
  orgUnitId: string;
  name: string;
  householdCount: number;
  deaconName: string | null;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      const result = await archiveDistrictAction(slug, { orgUnitId });
      if (result.ok) {
        toast.success(`${name} archived.`);
        setOpen(false);
      } else {
        toast.error(result.error);
        setOpen(false);
      }
      router.refresh();
    } catch {
      toast.error("We couldn't save that. Nothing was changed.");
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
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated}
          aria-label={`Archive ${name}`}
        >
          Archive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Archive {name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm break-words">
              <p>{archiveBodyCopy(householdCount)}</p>
              {deaconName ? <p>{archiveDeaconCopy(deaconName)}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending}
            onClick={confirm}
          >
            {pending ? "Archiving…" : "Archive district"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
