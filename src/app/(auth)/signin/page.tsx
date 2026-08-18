import { signIn } from "@/auth";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { isLocalLoginEnabled } from "@/lib/auth/local-login";
import { SignInCredentialsForm } from "./signin-credentials-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const callbackUrl = sanitizeCallbackUrl(sp.callbackUrl);
  // isLocalLoginEnabled() is fail-open — returns true on DB error or missing
  // row, so this read never causes a 500 on the sign-in page.
  const localLoginEnabled = await isLocalLoginEnabled();

  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in to your account.
      </p>

      {sp.error === "deactivated" && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          This account has been deactivated. Contact an administrator.
        </p>
      )}
      {sp.error === "CredentialsSignin" && (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
          Wrong email or password.
        </p>
      )}

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl });
        }}
        className="mt-6"
      >
        <button
          type="submit"
          className="w-full rounded-md border border-border bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
        >
          Sign in with Google
        </button>
      </form>

      {localLoginEnabled && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <SignInCredentialsForm callbackUrl={callbackUrl} />

          <p className="mt-4 text-xs text-muted-foreground">
            First time? Run <code>npm run db:seed</code> to provision the
            seeded admin user.
          </p>
        </>
      )}
    </main>
  );
}
