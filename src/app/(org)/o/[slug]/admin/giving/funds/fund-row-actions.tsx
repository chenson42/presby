"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { useHydrated } from "@/components/shared/use-hydrated";
import type { FundRow } from "@/lib/giving/funds";
import { FundForm } from "./fund-form";
import { reactivateFundAction, retireFundAction } from "./actions";

/**
 * One fund's controls: edit (inline), retire (an AlertDialog; retiring the last
 * online fund while the public page is live asks a second time), reactivate.
 * Plain `onClick` controls render disabled until hydrated (F129).
 */
export function FundRowActions({ slug, fund }: { slug: string; fund: FundRow }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [retireOpen, setRetireOpen] = useState(false);
  const [lastOnlineOpen, setLastOnlineOpen] = useState(false);

  async function retire(confirm: boolean) {
    setPending(true);
    const result = await retireFundAction(slug, { fundId: fund.id, confirm });
    setPending(false);
    if (!result.ok) {
      if (result.kind === "two_factor_required" && result.redirectTo) {
        window.location.assign(result.redirectTo);
        return;
      }
      toast.error(result.error);
      return;
    }
    if (result.data?.confirmRequired === "last_online_fund") {
      setRetireOpen(false);
      setLastOnlineOpen(true);
      return;
    }
    setRetireOpen(false);
    setLastOnlineOpen(false);
    toast.success(`${fund.name} retired.`);
    router.refresh();
  }

  async function reactivate() {
    setPending(true);
    const result = await reactivateFundAction(slug, { fundId: fund.id });
    setPending(false);
    if (result.ok) {
      toast.success(`${fund.name} is active again. It is not offered online until you turn that on.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!hydrated || pending}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Close editor" : "Edit"}
        </Button>
        {fund.isActive ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated || pending}
            onClick={() => setRetireOpen(true)}
          >
            Retire
          </Button>
        ) : (
          <Button type="button" className="min-h-11" disabled={!hydrated || pending} onClick={reactivate}>
            Reactivate
          </Button>
        )}
      </div>

      {editing && (
        <div className="rounded-lg border border-border p-4">
          <FundForm
            slug={slug}
            fund={fund}
            canOfferOnline={fund.isActive}
            onDone={() => setEditing(false)}
          />
        </div>
      )}

      <AlertDialog open={retireOpen} onOpenChange={setRetireOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {fund.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A retired fund can&apos;t take new gifts and is taken off the public give page.
              Its past gifts stay exactly as they are, and you can reactivate it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void retire(false);
              }}
            >
              {pending ? "Retiring…" : "Retire fund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={lastOnlineOpen} onOpenChange={setLastOnlineOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This is your only online fund</AlertDialogTitle>
            <AlertDialogDescription>
              Your public give page is live, and {fund.name} is the only fund it offers. If you
              retire it, donors will have nothing to give to until you offer another fund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void retire(true);
              }}
            >
              {pending ? "Retiring…" : "Retire anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
