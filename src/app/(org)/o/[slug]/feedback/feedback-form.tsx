"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitCongregationFeedbackAction } from "./actions";

/**
 * The baseline-member congregation-feedback on-ramp (Flow 0). A DISTINCT
 * component from `src/components/shared/feedback-form.tsx` — different
 * table (`congregation_feedback`, not the platform `feedback`), different
 * action, different audience predicate (this one requires an active org
 * relationship; the platform one has no org concept at all). Reusing the
 * shared component would mean branching its internals on which table to
 * write to — the "two products sharing a textarea" shape DECISION-070
 * already rejected at the schema layer.
 */
export function CongregationFeedbackForm({ slug }: { slug: string }) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();

  const trimmedLength = body.trim().length;
  const isSubmitDisabled = trimmedLength === 0 || isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitDisabled) return;

    startTransition(async () => {
      const result = await submitCongregationFeedbackAction(slug, body);
      if (result.ok) {
        toast.success("Thanks — your feedback has been shared.");
        setBody("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="congregation-feedback-body">
          What&apos;s on your mind?
        </Label>
        <Textarea
          id="congregation-feedback-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Share a suggestion, a problem, or anything else about your experience here."
          disabled={isPending}
          className="mt-1"
        />
        <span
          className={`mt-0.5 block text-right text-xs ${
            body.length > 1900 ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {body.length}/2000
        </span>
      </div>
      <Button type="submit" disabled={isSubmitDisabled} className="min-h-11">
        {isPending ? "Sending…" : "Share feedback"}
      </Button>
    </form>
  );
}
