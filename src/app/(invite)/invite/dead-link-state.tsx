import Link from "next/link";
import { Button } from "@/components/ui/button";
import { INVITATION_DEAD_LINK_COPY } from "@/lib/onboarding/labels";
import { InviteShell } from "./invite-shell";
import { RecheckOnce } from "./recheck-once";

/**
 * The one dead-link page (DECISION-147 bucket): no such token, expired,
 * revoked, superseded by a resend, already used, blocked, or simply no token
 * at all render this exact markup, so the page distinguishes nothing about why.
 * The sign-in hint is static text for the same reason. `recheck` is for the
 * no-token render only: see `RecheckOnce`.
 */
export function DeadLinkState({ recheck = false }: { recheck?: boolean }) {
  return (
    <InviteShell>
      {recheck && <RecheckOnce />}
      <h1 className="text-2xl font-semibold">This link isn&apos;t active</h1>
      <p role="status" className="mt-3 text-base">
        {INVITATION_DEAD_LINK_COPY}
      </p>
      <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
        <Link href="/signin">Go to sign in</Link>
      </Button>
    </InviteShell>
  );
}
