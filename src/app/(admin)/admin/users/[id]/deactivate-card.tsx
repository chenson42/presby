"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { deactivateUser, reactivateUser } from "../actions";

interface DeactivateCardProps {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
}

export function DeactivateCard({ userId, isActive, isSelf }: DeactivateCardProps) {
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleDeactivate() {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await deactivateUser({ userId });
      if (result.ok) {
        toast.success("User deactivated. They will be blocked on their next request.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleReactivate() {
    startTransition(async () => {
      const result = await reactivateUser({ userId });
      if (result.ok) {
        toast.success("User reactivated.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-md border border-border p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Account status</h2>
        {isActive ? (
          <span className="inline-flex items-center rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
            Active
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
            Inactive
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {isActive
          ? "Deactivating blocks all sign-in and page access immediately (on the user's next request)."
          : "This account is deactivated. Reactivating restores full access."}
      </p>

      <div className="mt-6">
        {isActive ? (
          <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                disabled={isSelf || isPending}
                className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={isSelf ? "You cannot deactivate your own account." : undefined}
              >
                Deactivate account
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg">
                <Dialog.Title className="text-lg font-semibold">
                  Deactivate this account?
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-muted-foreground">
                  The user will be blocked from signing in and accessing any page
                  on their next request. Their roles and 2FA enrollment are
                  preserved — reactivating restores full access.
                </Dialog.Description>
                <div className="mt-6 flex justify-end gap-3">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="button"
                    onClick={handleDeactivate}
                    disabled={isPending}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Yes, deactivate
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : (
          <button
            type="button"
            onClick={handleReactivate}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reactivate account
          </button>
        )}
        {isSelf && isActive && (
          <p className="mt-2 text-xs text-muted-foreground">
            You cannot deactivate your own account.
          </p>
        )}
      </div>
    </div>
  );
}
