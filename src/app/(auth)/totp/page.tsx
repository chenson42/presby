import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userTotp } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyTotpAction } from "./actions";

export default async function TotpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const sp = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);

  const enrollment = await db.query.userTotp.findFirst({
    where: eq(userTotp.userId, session.user.id),
  });

  if (!enrollment) {
    redirect(
      "/account/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)
    );
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
      <form action={verifyTotpAction} className="mt-6 space-y-3">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <Label htmlFor="totp-token">6-digit code or recovery code</Label>
        <Input
          id="totp-token"
          name="token"
          autoComplete="one-time-code"
          required
          className="tracking-widest"
          placeholder="123456 or ABCD-EFGH"
          autoFocus
        />
        {sp.error === "invalid" && (
          <p className="text-sm text-red-500">
            That code didn&apos;t match. Try again, or use a recovery code.
          </p>
        )}
        {sp.error === "rate_limited" && (
          <p className="text-sm text-red-500">
            Too many attempts. Please wait a moment before trying again.
          </p>
        )}
        <Button type="submit" className="w-full">
          Verify
        </Button>
      </form>
    </main>
  );
}
