"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Turnstile } from "@/components/shared/turnstile";
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
        <label htmlFor="signin-email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
          placeholder="admin@claudecode.info"
        />
      </div>
      <div>
        <label htmlFor="signin-password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="signin-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isPending}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
      </div>
      <Turnstile
        onVerify={setTurnstileToken}
        onExpire={() => setTurnstileToken("")}
        onError={() => setTurnstileToken("")}
      />
      <button
        type="submit"
        disabled={submitDisabled}
        className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
      >
        {isPending ? "Signing in…" : "Sign in with email"}
      </button>
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
