import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { InviteShell } from "../invite-shell";

export const metadata: Metadata = {
  title: "Your account is ready",
  robots: { index: false, follow: false },
};

/**
 * `/invite/accepted` - the static confirmation `acceptNewAccountAction()`
 * redirects to. Accepts no token and no parameter (like
 * `/file-statistics/submitted`): rendering it as a state of `/invite` would let
 * a reload re-submit a consumed token. No auto sign-in in v1 (Q7), so the one
 * button goes to the standard sign-in form.
 */
export default function InviteAcceptedPage() {
  return (
    <InviteShell>
      <h1 className="text-2xl font-semibold">Your account is ready</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Sign in with the email address the invitation was sent to and the password you just
        chose. If your role needs two-factor sign-in, you will be walked through setting it up
        the first time.
      </p>
      <Button asChild className="mt-6 min-h-11 w-full">
        <Link href="/signin?callbackUrl=/launch">Sign in</Link>
      </Button>
    </InviteShell>
  );
}
