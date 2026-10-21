import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { userTotp } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { TotpChallengeForm } from "./totp-challenge-form";

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

  const error =
    sp.error === "invalid" || sp.error === "rate_limited" ? sp.error : undefined;

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Two-factor authentication</h1>
      <TotpChallengeForm callbackUrl={callbackUrl} error={error} />
    </main>
  );
}
