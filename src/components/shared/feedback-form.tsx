"use client";

// TEACHING NOTE: to gate this form behind a feature flag, add:
//   if (!flagEnabled) return null;
// where flagEnabled is passed as a prop from the server component, e.g.:
//   const flagEnabled = await isFlagEnabled('feedback.v1');
// and pass it as a prop: <FeedbackForm flagEnabled={flagEnabled} />

import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/app/(member)/feedback/actions";
import { APP_VERSION } from "@/lib/version";

type Category = "suggestion" | "bug" | "other" | "";

interface FeedbackFormProps {
  /** Called after a successful submission (e.g. to close a Dialog wrapper). */
  onSuccess?: () => void;
}

export function FeedbackForm({ onSuccess }: FeedbackFormProps) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>("");
  const [isPending, startTransition] = useTransition();

  const trimmedLength = body.trim().length;
  const isSubmitDisabled = trimmedLength === 0 || isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitDisabled) return;

    // Capture TZ offset at submit time — not at mount — to reflect current offset.
    const tzOffsetMinutes = new Date().getTimezoneOffset();
    // Capture contextPath at submit time for bug reports.
    const contextPath =
      category === "bug" && typeof window !== "undefined"
        ? window.location.pathname
        : null;

    startTransition(async () => {
      const result = await submitFeedback({
        body,
        category: category === "" ? null : category,
        contextPath,
        appVersion: category === "bug" ? APP_VERSION : null,
        tzOffsetMinutes,
      });

      if (result.ok) {
        toast.success("Thanks — we read every one.");
        setBody("");
        setCategory("");
        onSuccess?.();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3">
      {/* Category */}
      <div>
        <Label htmlFor="feedback-category">
          Category{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        {/* "none" sentinel (empty string maps to null in the action) per ui-standards.md */}
        <div className="relative mt-1">
          <select
            id="feedback-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            disabled={isPending}
            className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-base focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
          >
            <option value="">No preference</option>
            <option value="suggestion">Suggestion</option>
            <option value="bug">Bug report</option>
            <option value="other">General feedback</option>
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      {/* Bug context — auto-captured, read-only */}
      {category === "bug" && (
        <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <div>
            Page:{" "}
            {typeof window !== "undefined" ? window.location.pathname : ""}
          </div>
          <div>Version: {APP_VERSION}</div>
        </div>
      )}

      {/* Body */}
      <div>
        <Label htmlFor="feedback-body">Message</Label>
        <Textarea
          id="feedback-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="What's on your mind?"
          disabled={isPending}
          className="mt-1"
        />
        {/* Character counter */}
        <span
          className={`mt-0.5 block text-right text-xs ${
            body.length > 1900
              ? "text-orange-600 dark:text-orange-400"
              : "text-muted-foreground"
          }`}
        >
          {body.length}/2000
        </span>
      </div>

      {/* Actions — stacked on mobile, row on sm+ per Phase 3 spec */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
        <Button type="submit" disabled={isSubmitDisabled}>
          {isPending ? "Sending…" : "Send feedback"}
        </Button>
      </div>
    </form>
  );
}
