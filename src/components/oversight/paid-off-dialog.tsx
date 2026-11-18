"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markLoanPaidOffAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/loans/actions";
import { TOAST } from "@/lib/oversight/copy";
import { parsePaidOff, type ValidationEnv } from "@/lib/oversight/validate";

/** "Mark paid off": the date the loan was paid off, in a small dialog (plain controlled input; the action sets the balance to $0 as of that date). */
export function PaidOffDialog({
  slug,
  aboutOrgId,
  loanId,
  env,
}: {
  slug: string;
  aboutOrgId: string;
  loanId: string;
  env: ValidationEnv;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidOffOn, setPaidOffOn] = useState(env.today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const values = { paidOffOn };
    const parsed = parsePaidOff(values, env);
    if (!parsed.ok) {
      setError(parsed.errors.paidOffOn ?? parsed.message);
      return;
    }
    setError(null);
    setPending(true);
    const result = await markLoanPaidOffAction(slug, aboutOrgId, loanId, values);
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.loanPaidOff);
      setOpen(false);
      router.refresh();
    } else if (result.field) {
      setError(result.error);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          Mark paid off
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Mark this loan paid off?</DialogTitle>
            <DialogDescription>This sets the balance to $0 as of the date you choose.</DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="paid-off-date">Date paid off</Label>
            <Input
              id="paid-off-date"
              type="date"
              value={paidOffOn}
              onChange={(e) => setPaidOffOn(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "paid-off-date-error" : undefined}
              className="mt-1 min-h-11"
            />
            {error ? (
              <p id="paid-off-date-error" className="mt-1 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="min-h-11">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="min-h-11">
              Mark paid off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
