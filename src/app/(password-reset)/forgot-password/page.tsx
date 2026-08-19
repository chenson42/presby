"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { requestPasswordReset } from "../actions";
import { Turnstile } from "@/components/shared/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const siteKeySet = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await requestPasswordReset({
        email: email.trim(),
        turnstileToken: turnstileToken || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        // Reset token so the widget refires a new challenge before the next attempt.
        setTurnstileToken("");
      } else {
        setIsSuccess(true);
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSuccess) {
    return (
      <main className="mx-auto max-w-sm px-6 py-24">
        <div className="rounded-lg border border-border bg-background p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            If an account exists with that email address, a password reset link
            has been sent. The link expires in 60 minutes.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button asChild>
              <Link href="/signin">Back to sign in</Link>
            </Button>
            <button
              type="button"
              onClick={() => {
                setIsSuccess(false);
                setEmail("");
              }}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Try a different email
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Forgot password?</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Enter your email address and we&apos;ll send you a reset link if an
        account exists.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="forgot-email">Email</Label>
          <Input
            id="forgot-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            className="mt-1"
            placeholder="you@example.com"
          />
        </div>
        <Turnstile
          onVerify={setTurnstileToken}
          onExpire={() => setTurnstileToken("")}
          onError={() => setTurnstileToken("")}
        />
        <Button
          type="submit"
          disabled={isSubmitting || (siteKeySet && !turnstileToken)}
          className="w-full"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        <Link
          href="/signin"
          className="underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
