import { InviteShell } from "./invite-shell";

/**
 * A database blip while previewing. Deliberately not the dead-link page: a
 * transient failure must not tell a valid invitee their link is dead. The
 * link (and its token) is untouched, so reloading is the whole remedy.
 */
export function UnavailableState() {
  return (
    <InviteShell>
      <h1 className="text-2xl font-semibold">We can&apos;t load this invitation</h1>
      <p role="alert" className="mt-3 text-base">
        Something went wrong on our side. Your link is still good. Reload this page in a moment to try again.
      </p>
    </InviteShell>
  );
}
