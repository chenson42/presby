import Link from "next/link";

/**
 * F344: an enrolled person whose session has not passed the second factor cannot
 * make new recovery codes (the action refuses; this is the way back). `/totp`
 * accepts any signed-in enrolled user, with an app code or a recovery code, and
 * returns to `/account/2fa`. `callbackUrl` is the value the page already
 * sanitized; it is carried only so Continue still works after the round trip.
 */
export function ConfirmItsYou({
  callbackUrl,
  hasCallback,
}: {
  callbackUrl: string;
  hasCallback: boolean;
}) {
  const returnTo = hasCallback
    ? `/account/2fa?${new URLSearchParams({ callbackUrl }).toString()}`
    : "/account/2fa";
  const href = `/totp?${new URLSearchParams({ callbackUrl: returnTo }).toString()}`;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted-foreground">
        To make new recovery codes, first confirm it&apos;s you with your
        authenticator app or a recovery code.
      </p>
      <Link
        href={href}
        className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-2"
      >
        Confirm it&apos;s you
      </Link>
    </div>
  );
}
