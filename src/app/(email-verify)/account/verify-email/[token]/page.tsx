// This page is intentionally reachable without an active session.
// The proxy grants access to /account/verify-email/* without authentication.
// See src/proxy.ts for the prefix exception.
//
// This page lives in the (email-verify) route group, which has NO layout.
// Moving it here (away from the (account) route group) prevents the (account)
// layout's auth() + redirect from firing for unauthenticated visitors who
// click a verification link in a fresh browser session.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { completeEmailChange } from "@/lib/auth/email-change";

interface Props {
  params: Promise<{ token: string }>;
}

// The change itself (consume the token, write the new address AND its proof
// stamp, audit) is `completeEmailChange` (Community Increment 2b, R38,
// DECISION-225): since drizzle/0065 a non-owner role cannot write
// `users.email_verified`, so the page no longer updates `users` itself. The
// three messages below are the page's long-standing copy, kept byte for byte.
export default async function VerifyEmailPage({ params }: Props) {
  const { token } = await params;

  const result = await completeEmailChange(token);

  switch (result.kind) {
    case "invalid":
      return <ErrorCard message="This verification link is invalid or has already been used." />;
    case "expired":
      return <ErrorCard message="This verification link has expired. Request a new one from your account settings." />;
    case "email_taken":
      // A 23505 can occur if two users concurrently verify tokens that both
      // target the same address (TOCTOU on the requestEmailChange check), or if
      // the address is held in another letter case (users_email_lower_uq).
      return (
        <ErrorCard message="This email address has already been claimed by another account. Request a new verification link from your account settings." />
      );
    case "error":
      // Unexpected database failure: as before, not a message of its own. The
      // error boundary answers (the token is still live; nothing was changed).
      throw new Error("email change could not be completed");
    case "ok":
      break;
  }

  revalidatePath("/account");

  // Redirect to account page with a success flag; the page will show a toast.
  redirect("/account?emailChanged=1");
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Email verification failed</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        <Button asChild className="mt-6">
          <Link href="/account">Back to account settings</Link>
        </Button>
      </div>
    </div>
  );
}
