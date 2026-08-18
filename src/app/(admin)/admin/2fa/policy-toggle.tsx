"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setOrganizationTwoFactorAction } from "./actions";

interface TwoFactorPolicyToggleProps {
  organizationId: string;
  organizationName: string;
  required: boolean;
}

/**
 * Client island for one congregation's 2FA requirement.
 *
 * Turning the requirement ON is the consequential direction: every member of
 * that congregation is asked for a code at their next sign-in, and anyone who
 * has not enrolled will need help. The confirmation copy says so plainly rather
 * than making the admin infer it — and it says it in the toast, because a
 * native confirm() is forbidden (Workflow Rule 2).
 */
export function TwoFactorPolicyToggle({
  organizationId,
  organizationName,
  required,
}: TwoFactorPolicyToggleProps) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("organizationId", organizationId);
      formData.set("required", String(!required));

      const result = await setOrganizationTwoFactorAction(formData);
      if (result.ok) {
        toast.success(
          required
            ? `${organizationName} no longer requires two-factor.`
            : `${organizationName} now requires two-factor — members are asked at their next sign-in.`,
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isPending ? "Saving…" : required ? "Make optional" : "Require 2FA"}
    </button>
  );
}
