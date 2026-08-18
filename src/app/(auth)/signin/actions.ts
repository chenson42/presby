"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export interface SignInInput {
  email: string;
  password: string;
  turnstileToken?: string;
  callbackUrl: string;
}

/**
 * Server action wrapper for credentials sign-in. Matches the pattern
 * established in src/app/(auth)/totp/actions.ts (DECISION-021).
 *
 * On success: Next.js catches the NEXT_REDIRECT throw and follows the redirect.
 * On AuthError: returns { error } so the client form can display inline error.
 * On any other error: re-throws (never swallow NEXT_REDIRECT).
 */
export async function signInWithCredentials(
  input: SignInInput,
): Promise<{ error: string } | undefined> {
  try {
    await signIn("credentials", {
      email: input.email,
      password: input.password,
      turnstileToken: input.turnstileToken ?? "",
      redirectTo: input.callbackUrl,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // CredentialsSignin and other NextAuth errors — return a friendly message.
      // Do not re-throw: the client shows the inline error and resets the widget.
      return { error: "Wrong email or password." };
    }
    // NEXT_REDIRECT and any other error must propagate so Next.js can handle them.
    throw err;
  }
}
