"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useHydrated } from "@/components/shared/use-hydrated";
import { DonorPicker } from "../gifts/new/donor-picker";
import { mergeDonorsAction } from "./actions";

/**
 * Merge a donor into another (`giving.manage`) - docs/work-log/
 * 2026-10-15-online-giving.md, "Donor merge with links". An AlertDialog that
 * names BOTH donors and says what survives: this donor's gifts and statements
 * are read through the donor it is merged into, nothing is deleted, and it
 * cannot be undone. With `target` preset (a suggested duplicate) it is one
 * confirmation; without, it first asks which donor to keep, using the same
 * search-then-pick list as the gift form.
 */
export function MergeDonorDialog({
  slug,
  source,
  target,
  label,
}: {
  slug: string;
  source: { id: string; displayName: string };
  target?: { id: string; displayName: string };
  label: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; displayName: string } | null>(target ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const keep = target ?? chosen;

  async function merge() {
    if (!keep) return;
    setPending(true);
    setError(undefined);
    const result = await mergeDonorsAction(slug, { sourceId: source.id, targetId: keep.id });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.success(`${source.displayName} merged into ${keep.displayName}.`);
      router.push(`/o/${slug}/admin/giving/donors/${keep.id}`);
      router.refresh();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    setError(result.error);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(undefined);
          if (!target) setChosen(null);
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge {source.displayName} into {keep ? keep.displayName : "another donor"}?</AlertDialogTitle>
          <AlertDialogDescription>
            Gifts and statements for {source.displayName} will show under the donor you keep. Nothing is
            deleted, but a merge can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!target && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Which donor should be kept?</p>
            <DonorPicker slug={slug} inputId={`merge-search-${source.id}`} value={chosen} onChange={setChosen} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Don&apos;t merge</AlertDialogCancel>
          <Button type="button" disabled={pending || !keep || keep.id === source.id} onClick={merge}>
            {pending ? "Merging…" : "Merge donors"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
