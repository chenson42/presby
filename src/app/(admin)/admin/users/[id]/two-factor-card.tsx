"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { setTwoFactorRequired, forceResetTwoFactor } from "./actions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface TwoFactorCardProps {
  userId: string;
  twoFactorRequired: boolean;
  enrolled: boolean;
  enrolledAt: Date | null;
  unusedRecoveryCodeCount: number;
  isSelf: boolean;
}

export function TwoFactorCard({
  userId,
  twoFactorRequired,
  enrolled,
  enrolledAt,
  unusedRecoveryCodeCount,
  isSelf,
}: TwoFactorCardProps) {
  const [isPending, startTransition] = useTransition();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  function handleToggleRequired(nextRequired: boolean) {
    startTransition(async () => {
      const result = await setTwoFactorRequired({
        userId,
        required: nextRequired,
      });
      if (result.ok) {
        toast.success(
          nextRequired
            ? "2FA is now required. Takes effect on the user's next page load."
            : "2FA requirement disabled. Takes effect on the user's next page load.",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleForceReset() {
    setResetDialogOpen(false);
    startTransition(async () => {
      const result = await forceResetTwoFactor({ userId });
      if (result.ok) {
        toast.success(
          "2FA enrollment wiped. The user will be required to re-enroll on their next sign-in.",
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  // Badge rendering: !required takes priority over enrolled/verified state.
  function renderStatusBadge() {
    if (!twoFactorRequired) {
      return (
        <Badge
          variant="outline"
          className="bg-amber-500/15 text-amber-700 dark:text-amber-300"
        >
          2FA not required
        </Badge>
      );
    }
    if (enrolled) {
      return (
        <Badge
          variant="outline"
          className="bg-green-500/15 text-green-700 dark:text-green-300"
        >
          Enrolled
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="bg-red-500/15 text-red-700 dark:text-red-300"
      >
        Not enrolled
      </Badge>
    );
  }

  return (
    <div className="rounded-md border border-border p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Two-factor authentication</h2>
        {renderStatusBadge()}
      </div>

      {enrolled && enrolledAt && (
        <p className="mt-2 text-sm text-muted-foreground">
          Enrolled on <FormattedDate value={enrolledAt} mode="date" />.{" "}
          {unusedRecoveryCodeCount} unused recovery code
          {unusedRecoveryCodeCount === 1 ? "" : "s"} remaining.
        </p>
      )}
      {!enrolled && twoFactorRequired && (
        <p className="mt-2 text-sm text-muted-foreground">
          This user has not enrolled in TOTP. They will be prompted on next
          sign-in.
        </p>
      )}
      {!twoFactorRequired && (
        <p className="mt-2 text-sm text-muted-foreground">
          Disabling does not remove an enrolled TOTP secret. If you re-enable
          the requirement, the user&apos;s existing secret remains valid.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {/* Require 2FA toggle */}
        <div className="flex items-start gap-3">
          <input
            id="require-2fa"
            type="checkbox"
            checked={twoFactorRequired}
            disabled={isSelf || isPending}
            onChange={(e) => handleToggleRequired(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input disabled:cursor-not-allowed disabled:opacity-50"
          />
          <div>
            <Label
              htmlFor="require-2fa"
              className={isSelf ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
            >
              Require 2FA
            </Label>
            <p className="text-xs text-muted-foreground">
              {isSelf
                ? "You cannot change your own 2FA requirement."
                : "When enabled, the user must complete TOTP before accessing the admin shell."}
            </p>
          </div>
        </div>

        {/* Force-reset button */}
        {enrolled && (
          <Dialog.Root open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
            <Dialog.Trigger asChild>
              <Button type="button" variant="destructive" size="sm" disabled={isPending}>
                Force-reset 2FA enrollment
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg">
                <Dialog.Title className="text-lg font-semibold">
                  Force-reset 2FA enrollment?
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                  This will permanently delete the user&apos;s TOTP secret,
                  recovery codes, and any pending enrollment. The user will be
                  required to re-enroll on their next sign-in.
                </Dialog.Description>
                <div className="mt-6 flex justify-end gap-3">
                  <Dialog.Close asChild>
                    <Button type="button" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleForceReset}
                  >
                    Yes, reset enrollment
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
    </div>
  );
}
