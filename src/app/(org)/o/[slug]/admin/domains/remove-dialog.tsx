"use client";

import { useState } from "react";
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
import { removeClaimAction } from "./actions";

export interface RemoveReplacement {
  id: string;
  displayHostname: string;
}

/**
 * Removes a domain. Explains what happens next in the words a church needs: the
 * address stops serving at once, we hold the name dark for 30 days so nobody
 * else can take it over, and there is a list of DNS records to clean up. A
 * domain that was never proven (nothing was connected) says so and promises
 * nothing more than it does.
 *
 * When this is the primary address and other addresses are live, the server
 * refuses without a replacement; the dialog asks which one becomes primary
 * BEFORE offering the button (the refusal is still handled, in a toast).
 */
export function RemoveDialog({
  slug,
  claimName,
  displayName,
  wasConnected,
  replacements,
}: {
  slug: string;
  claimName: string;
  displayName: string;
  /** False while only the ownership record was ever asked for. */
  wasConnected: boolean;
  /** Live addresses outside this domain that could become primary; non-empty only when this domain holds the primary address. */
  replacements: readonly RemoveReplacement[];
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [promote, setPromote] = useState<string>(replacements[0]?.id ?? "");

  async function confirm() {
    setPending(true);
    try {
      const result = await removeClaimAction(slug, claimName, replacements.length > 0 ? promote : undefined);
      if (result.ok) {
        toast.success(`${displayName} was removed.`);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("We couldn't remove it right now. Try again in a few minutes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated}>
          Remove
          <span className="sr-only"> {displayName}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Remove {displayName}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {wasConnected ? (
              <div className="space-y-2 break-words text-sm">
                <p>
                  Visitors to {displayName} will see a &quot;page not found&quot; message, and your PresbyPortal
                  address will serve your site again.
                </p>
                <p>
                  We keep the name on hold for 30 days so no one else can take it over while you tidy up. We&apos;ll
                  show you which DNS records to delete, and you can reconnect it during that time.
                </p>
              </div>
            ) : (
              <p className="break-words text-sm">
                Nothing was connected, so nothing else changes. You can add {displayName} again whenever you like.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {replacements.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-base font-medium">Which address becomes your primary address?</legend>
            {replacements.map((r) => (
              <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3">
                <input
                  type="radio"
                  name="promote"
                  value={r.id}
                  checked={promote === r.id}
                  onChange={() => setPromote(r.id)}
                  className="size-4"
                />
                <span className="break-all text-base">{r.displayHostname}</span>
              </label>
            ))}
          </fieldset>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
          <Button type="button" variant="destructive" className="min-h-11" disabled={pending} onClick={confirm}>
            {pending ? "Removing…" : "Remove domain"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
