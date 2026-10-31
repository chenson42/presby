import { AdminForbidden } from "@/components/admin-portal/admin-forbidden";
import { LoadError } from "@/components/shared/load-error";
import type { DeveloperGate } from "./guard";

/**
 * What a page renders when `requireDeveloper` did not return `ok`.
 *
 * - `forbidden`: the shared "doesn't include" page. HTTP 200, no redirect (a
 *   silent bounce to /home reads as revoked access or a bug, F288).
 * - `unavailable`: the access read THREW. Fails closed, says the fault is ours
 *   (true by construction: it renders only when the read threw), and offers a
 *   retry to the page's own literal path.
 *
 * `retryHref` is the same literal string the page passed to `requireDeveloper`.
 */
export function GateState({
  gate,
  retryHref,
}: {
  gate: Exclude<DeveloperGate, "ok">;
  retryHref: string;
}) {
  if (gate === "forbidden") {
    return (
      <AdminForbidden title="Developer portal" area="the developer portal" />
    );
  }
  return (
    <LoadError
      headingLevel={1}
      title="We can't check your access right now"
      body="This is on our end, not yours. Try again in a moment."
      retryHref={retryHref}
    />
  );
}
