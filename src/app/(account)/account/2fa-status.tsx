"use client";

import Link from "next/link";

interface TwoFactorStatusPillProps {
  isEnrolled: boolean;
}

export function TwoFactorStatusPill({ isEnrolled }: TwoFactorStatusPillProps) {
  return (
    <div className="mt-4 flex items-center gap-3">
      {isEnrolled ? (
        <>
          <span className="inline-flex items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
            Active
          </span>
          <Link
            href="/account/2fa"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage / regenerate codes
          </Link>
        </>
      ) : (
        <>
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            Not set up
          </span>
          <Link
            href="/account/2fa"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Set up two-factor authentication
          </Link>
        </>
      )}
    </div>
  );
}
