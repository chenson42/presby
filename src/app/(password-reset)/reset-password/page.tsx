"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { consumeResetToken } from "../actions";

// Inner component that reads useSearchParams — must be inside a Suspense boundary.
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawToken = searchParams.get("token") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // No token in query string — show error immediately, no DB call.
  if (!rawToken) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-background p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Invalid reset link</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            No reset token was found. Request a new password reset link.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await consumeResetToken({
        rawToken,
        newPassword,
      });

      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Password updated. Sign in with your new password.");
        router.push("/signin");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Set new password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter and confirm your new password below.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isSubmitting}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium"
          >
            Confirm new password
          </label>
          <input
            id="confirm-password"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isSubmitting}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {isSubmitting ? "Updating…" : "Set new password"}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Link expired or invalid?{" "}
        <Link
          href="/forgot-password"
          className="underline-offset-4 hover:underline"
        >
          Request a new one
        </Link>
      </p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-sm px-6 py-24">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
