import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, userTotp, emailVerificationTokens, feedbackPromptState } from "@/lib/db/schema";
import { ProfileForm } from "./profile-form";
import { EmailForm } from "./email-form";
import { PasswordForm } from "./password-form";
import { DeleteAccountButton } from "./delete-button";
import { TwoFactorStatusPill } from "./2fa-status";
import { SearchParamToast } from "./search-param-toast";
import { FeedbackForm } from "@/components/shared/feedback-form";
import { FeedbackOptOutToggle } from "./feedback-opt-out-toggle";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/account");

  const [userRow, totp, pendingToken, promptState] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { name: true, email: true, password: true },
    }),
    db.query.userTotp.findFirst({
      where: eq(userTotp.userId, session.user.id),
      columns: { userId: true },
    }),
    db.query.emailVerificationTokens.findFirst({
      where: eq(emailVerificationTokens.userId, session.user.id),
      columns: { newEmail: true },
    }),
    db.query.feedbackPromptState.findFirst({
      where: eq(feedbackPromptState.userId, session.user.id),
      columns: { optedOut: true },
    }),
  ]);

  if (!userRow) redirect("/signin");

  const hasPassword = userRow.password !== null;
  const isEnrolled = !!totp;

  return (
    <div className="max-w-xl space-y-8">
      <Suspense>
        <SearchParamToast />
      </Suspense>
      <h1 className="text-2xl font-semibold">Account settings</h1>

      {/* Card 1 — Profile */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-base font-medium">Profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Update your display name.
        </p>
        <ProfileForm name={userRow.name} />
      </section>

      {/* Card 2 — Email */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-base font-medium">Email address</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A verification link will be sent to your new address. Your sign-in
          email changes only after you click the link.
        </p>
        <EmailForm
          currentEmail={userRow.email}
          pendingEmail={pendingToken?.newEmail ?? null}
        />
      </section>

      {/* Card 3 — Password (Credentials users only) */}
      {hasPassword && (
        <section className="rounded-lg border border-border p-6">
          <h2 className="text-base font-medium">Password</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Change your sign-in password. Minimum 8 characters.
          </p>
          <PasswordForm />
        </section>
      )}

      {/* Card 4 — Two-Factor Authentication */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-base font-medium">Two-factor authentication</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an extra layer of security to your account using an authenticator
          app.
        </p>
        <TwoFactorStatusPill isEnrolled={isEnrolled} />
      </section>

      {/* Card 5 — Send feedback */}
      <section className="rounded-lg border border-border p-6">
        <h2 className="text-base font-medium">Send feedback</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Have a suggestion or spotted a bug? We read every submission.
        </p>
        <FeedbackForm />
        <div className="mt-4">
          <FeedbackOptOutToggle optedOut={promptState?.optedOut ?? false} />
        </div>
      </section>

      {/* Card 6 — Delete Account */}
      <section className="rounded-lg border border-red-500/20 p-6">
        <h2 className="text-base font-medium text-red-600">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently delete your account and all associated data. This action
          cannot be undone.
        </p>
        <div className="mt-4">
          <DeleteAccountButton />
        </div>
      </section>
    </div>
  );
}
