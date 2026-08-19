"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Turnstile } from "@/components/shared/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithCredentials } from "./actions";

// Evaluated at module scope — accessible in 'use client' for bundle-time baking.
const siteKeySet = !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

interface Props {
  callbackUrl: string;
}

export function SignInCredentialsForm({ callbackUrl }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitDisabled =
    !email || !password || (siteKeySet && !turnstileToken) || isPending;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signInWithCredentials({
        email,
        password,
        turnstileToken: turnstileToken || undefined,
        callbackUrl,
      });
      if (result?.error) {
        setError(result.error);
        // Blank the token so the widget refires a new challenge before the
        // next submission attempt.
        setTurnstileToken("");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          {error}
        </p>
      )}
      <div>
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isPending}
          className="mt-1"
          placeholder="admin@claudecode.info"
        />
      </div>
      <div>
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          className="mt-1"
        />
      </div>
      <Turnstile
        onVerify={setTurnstileToken}
        onExpire={() => setTurnstileToken("")}
        onError={() => setTurnstileToken("")}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={submitDisabled}
        className="w-full"
      >
        {isPending ? "Signing in…" : "Sign in with email"}
      </Button>
      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>
    </form>
  );
}
