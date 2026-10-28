import { Button } from "@/components/ui/button";

/**
 * "Continue" to the sanitized `callbackUrl` after two-factor setup. `href` must be
 * the value `sanitizeCallbackUrl()` returned on the server, never a raw query
 * string (the page computes it; the client holder only receives it as a prop).
 *
 * A plain <a>, not next/link, on purpose: a full document navigation drops the
 * recovery codes from client memory and guarantees the proxy reads the freshly
 * written session cookie. A 44px, full-width target at 360px, as the invite
 * pages' buttons are (`min-h-11 w-full`).
 */
export function ContinueButton({ href }: { href: string }) {
  return (
    <Button asChild className="mt-6 min-h-11 w-full">
      <a href={href}>Continue</a>
    </Button>
  );
}
