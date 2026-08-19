"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
          <Badge
            variant="outline"
            className="bg-green-500/15 text-green-700 dark:text-green-300"
          >
            Active
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="bg-red-500/15 text-red-700 dark:text-red-300"
          >
            Inactive
          </Badge>
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
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isSelf || isPending}
                title={isSelf ? "You cannot deactivate your own account." : undefined}
              >
                Deactivate account
              </Button>
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
                    <Button type="button" variant="outline" size="sm">
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDeactivate}
                    disabled={isPending}
                  >
                    Yes, deactivate
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReactivate}
            disabled={isPending}
          >
            Reactivate account
          </Button>
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
