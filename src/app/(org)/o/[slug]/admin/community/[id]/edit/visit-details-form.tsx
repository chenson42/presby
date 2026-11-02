"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/shared/use-hydrated";
import { FIRST_VISIT_FLOOR } from "@/lib/membership-standing";
import { updateVisitDetailsAction } from "../../actions";
import {
  ENGAGEMENT_SUCCESS_COPY,
  VISIT_DETAILS_COPY,
  VISIT_DETAILS_FORM_COPY,
} from "../../engagement-copy";

/**
 * "Visit details" on the edit page (Copy group F): correct the date of a first
 * visit and how the person heard of the congregation. Plain controlled inputs,
 * no `useForm` (the design's call, so `check:hydration-gate` does not apply);
 * every control is disabled until hydration (DECISION-159). A blank clears a
 * value. The date input has a floor but no ceiling attribute (a browser-local
 * "today" would differ between the server render and the client); the server
 * bounds it by the database's own date and answers with its own sentence, which
 * is shown under the field it belongs to; the text field has no `maxLength`, for
 * the same reason (a field that cannot be over-filled can never show the "under
 * 200 characters" sentence the design words). Saving what is already stored is a
 * quiet success on the server, and reads the same here.
 *
 * The page renders this only for a membership that has not ended (the writer
 * refuses an ended one) and only when it is useful: a visitor, or anyone with a
 * stored first visit or "how heard".
 */
export function VisitDetailsForm({
  slug,
  personId,
  firstVisitDate,
  howHeard,
}: {
  slug: string;
  personId: string;
  /** 'YYYY-MM-DD' or null, as stored. */
  firstVisitDate: string | null;
  howHeard: string | null;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const dateId = useId();
  const heardId = useId();
  const errorId = useId();
  const [date, setDate] = useState(firstVisitDate ?? "");
  const [heard, setHeard] = useState(howHeard ?? "");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: "date" | "heard"; message: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setFieldError(null);
    try {
      const result = await updateVisitDetailsAction(slug, {
        personId,
        firstVisitDate: date === "" ? null : date,
        howHeard: heard.trim() === "" ? null : heard.trim(),
      });
      if (result.ok) {
        toast.success(ENGAGEMENT_SUCCESS_COPY.visitDetailsSaved);
        router.refresh();
      } else if (result.error === VISIT_DETAILS_COPY.bad_date) {
        setFieldError({ field: "date", message: result.error });
      } else if (result.error === VISIT_DETAILS_COPY.bad_text) {
        setFieldError({ field: "heard", message: result.error });
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(VISIT_DETAILS_COPY.db_error);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} data-testid="visit-details-form" className="space-y-4" noValidate>
      <h3 className="text-base font-semibold">{VISIT_DETAILS_FORM_COPY.heading}</h3>
      <div>
        <Label htmlFor={dateId}>{VISIT_DETAILS_FORM_COPY.firstVisit}</Label>
        <Input
          id={dateId}
          type="date"
          min={FIRST_VISIT_FLOOR}
          value={date}
          disabled={!hydrated || pending}
          aria-invalid={fieldError?.field === "date" ? true : undefined}
          aria-describedby={fieldError?.field === "date" ? errorId : undefined}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 min-h-11"
        />
        {fieldError?.field === "date" && (
          <p id={errorId} role="alert" className="mt-1 break-words text-sm text-destructive">
            {fieldError.message}
          </p>
        )}
      </div>
      <div>
        <Label htmlFor={heardId}>{VISIT_DETAILS_FORM_COPY.howHeard}</Label>
        <Input
          id={heardId}
          value={heard}
          autoComplete="off"
          disabled={!hydrated || pending}
          aria-invalid={fieldError?.field === "heard" ? true : undefined}
          aria-describedby={fieldError?.field === "heard" ? errorId : undefined}
          onChange={(e) => setHeard(e.target.value)}
          className="mt-1 min-h-11"
        />
        {fieldError?.field === "heard" && (
          <p id={errorId} role="alert" className="mt-1 break-words text-sm text-destructive">
            {fieldError.message}
          </p>
        )}
      </div>
      <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={!hydrated || pending}>
        {pending ? VISIT_DETAILS_FORM_COPY.saving : VISIT_DETAILS_FORM_COPY.save}
      </Button>
    </form>
  );
}
