"use client";

// TEACHING NOTE: The daily prompt card is always shown to authenticated users
// who haven't snoozed, submitted, or opted out today. To gate it behind a
// feature flag, pass a prop from the server component:
//   const flagEnabled = await isFlagEnabled('feedback.v1');
//   {flagEnabled && shouldShow && <FeedbackPromptCard />}
// This demonstrates the pattern without shipping an always-on flag.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FeedbackForm } from "@/components/shared/feedback-form";
import {
  snoozeFeedbackPrompt,
  setFeedbackOptOut,
} from "@/app/(member)/feedback/actions";

export function FeedbackPromptCard() {
  const router = useRouter();

  // Capture TZ offset at mount — used for snooze action.
  const [tzOffset] = useState(() => new Date().getTimezoneOffset());
  const [visible, setVisible] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [optOutAlertOpen, setOptOutAlertOpen] = useState(false);
  const [snoozePending, setSnoozePending] = useState(false);
  const [optOutPending, setOptOutPending] = useState(false);

  if (!visible) return null;

  async function handleSnooze() {
    setSnoozePending(true);
    const result = await snoozeFeedbackPrompt(tzOffset);
    setSnoozePending(false);
    if (result.ok) {
      setVisible(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Something went wrong — try again.");
    }
  }

  async function handleOptOut() {
    setOptOutAlertOpen(false);
    setOptOutPending(true);
    const result = await setFeedbackOptOut(true);
    setOptOutPending(false);
    if (result.ok) {
      setVisible(false);
      router.refresh();
    } else {
      toast.error(result.error ?? "Something went wrong — try again.");
    }
  }

  return (
    <div className="rounded-lg border border-border p-5">
      <h2 className="text-base font-medium">How are we doing?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Have a suggestion or spotted a bug? We&apos;d love to hear it.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        {/* "Share feedback" → Dialog with FeedbackForm */}
        <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
          <Dialog.Trigger asChild>
            <Button type="button">Share feedback</Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg max-h-[90dvh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg focus:outline-none">
              <Dialog.Title className="text-lg font-semibold">
                Share feedback
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                We read every submission. Your feedback shapes what we build
                next.
              </Dialog.Description>
              <FeedbackForm
                onSuccess={() => {
                  setDialogOpen(false);
                  setVisible(false);
                  router.refresh();
                }}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* "Not today" — snooze until tomorrow */}
        <Button
          type="button"
          variant="outline"
          onClick={handleSnooze}
          disabled={snoozePending || optOutPending}
        >
          {snoozePending ? "Saving…" : "Not today"}
        </Button>

        {/* "Stop asking" → AlertDialog confirm before opt-out */}
        <AlertDialog open={optOutAlertOpen} onOpenChange={setOptOutAlertOpen}>
          <button
            type="button"
            onClick={() => setOptOutAlertOpen(true)}
            disabled={snoozePending || optOutPending}
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 transition-colors"
          >
            Stop asking
          </button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop daily prompts?</AlertDialogTitle>
              <AlertDialogDescription>
                You can re-enable the daily prompt any time from Account
                settings &rarr; Send feedback.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Never mind</AlertDialogCancel>
              <AlertDialogAction onClick={handleOptOut} disabled={optOutPending}>
                Yes, stop asking
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
