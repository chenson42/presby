"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface TwoFactorStatusPillProps {
  isEnrolled: boolean;
}

export function TwoFactorStatusPill({ isEnrolled }: TwoFactorStatusPillProps) {
  return (
    <div className="mt-4 flex items-center gap-3">
      {isEnrolled ? (
        <>
          <Badge
            variant="outline"
            className="border-transparent bg-green-500/10 text-green-700 dark:text-green-300"
          >
            Active
          </Badge>
          <Link
            href="/account/2fa"
            className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage / regenerate codes
          </Link>
        </>
      ) : (
        <>
          <Badge
            variant="outline"
            className="border-transparent bg-amber-500/10 text-amber-700 dark:text-amber-300"
          >
            Not set up
          </Badge>
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
