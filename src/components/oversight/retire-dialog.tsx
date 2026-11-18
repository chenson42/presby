"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
import { retireBuildingAction } from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/actions";
import { RETIRE_REASONS } from "@/lib/oversight/contract";
import { TOAST } from "@/lib/oversight/copy";
import { parseRetire, type ValidationEnv } from "@/lib/oversight/validate";
import { SELECT_CLASSES } from "./select-classes";

/**
 * "Retire this building": a reason and a date in a small dialog (plain controlled
 * inputs, no `useForm`; the dialog opens only after the page has hydrated). The
 * pure `parseRetire` is the same check the action runs, so the messages are C9's.
 */
export function RetireDialog({
  slug,
  aboutOrgId,
  buildingId,
  buildingName,
  env,
}: {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  buildingName: string;
  env: ValidationEnv;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [retiredOn, setRetiredOn] = useState(env.today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const values = { reason, retiredOn };
    const parsed = parseRetire(values, env);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await retireBuildingAction(slug, aboutOrgId, buildingId, values);
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.buildingRetired);
      setOpen(false);
      router.refresh();
    } else if (result.field) {
      setErrors({ [result.field]: result.error });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          Retire this building
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>Retire {buildingName}?</DialogTitle>
            <DialogDescription>
              A retired building leaves the active list. Its history stays, and you can bring it back into use.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="retire-reason">Why is it retired?</Label>
            <div className="relative mt-1">
              <select
                id="retire-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={errors.reason ? true : undefined}
                aria-describedby={errors.reason ? "retire-reason-error" : undefined}
                className={SELECT_CLASSES}
              >
                <option value="">Choose why</option>
                {RETIRE_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            {errors.reason ? (
              <p id="retire-reason-error" className="mt-1 text-sm text-destructive">
                {errors.reason}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="retire-date">Date</Label>
            <Input
              id="retire-date"
              type="date"
              value={retiredOn}
              onChange={(e) => setRetiredOn(e.target.value)}
              aria-invalid={errors.retiredOn ? true : undefined}
              aria-describedby={errors.retiredOn ? "retire-date-error" : undefined}
              className="mt-1 min-h-11"
            />
            {errors.retiredOn ? (
              <p id="retire-date-error" className="mt-1 text-sm text-destructive">
                {errors.retiredOn}
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
              Retire building
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
