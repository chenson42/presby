import { cachedAuth } from "@/lib/auth/cached-auth";
import { resolveOrgContext } from "@/lib/authz";
import { assertGivingSession, loadGivingContext } from "@/lib/giving/access";
import { readOpenConnectionMode } from "@/lib/giving/connection";
import { TestModeBadge } from "@/components/giving/test-mode-badge";

/**
 * The test-mode badge, wired once for every giving admin page through
 * `layout.tsx` (docs/work-log/2026-10-15-online-giving.md, G14), so no page has
 * to remember it.
 *
 * It is NOT a gate. Every page still runs `gateGivingPage()` itself and decides
 * what the viewer may see; this slot is a best-effort extra that renders ONLY
 * when the viewer is signed in, passes the same 2FA check, is a current member,
 * the org's Giving toggle is on and they hold at least one giving key - the
 * same answers the gate would give "ok" for. Anything else, and any failure at
 * all, renders nothing: a missing badge must never take down a page, and it
 * must never tell an outsider that a congregation is in test mode. (The four-way
 * miss is the PAGE's job; the slot stays silent for every non-ok case.)
 *
 * Both lookups it shares with the page (`cachedAuth`) are request-cached; the
 * gate answers are re-read (a few indexed lookups) rather than threaded through
 * the page, which is what keeps the 9 pages untouched.
 */
export async function TestModeSlot({ slug }: { slug: string }) {
  const testMode = await isOpenConnectionInTestMode(slug);
  return testMode ? <TestModeBadge /> : null;
}

/** Every "no" - and every failure - is `false`: the slot is best-effort and silent. */
async function isOpenConnectionInTestMode(slug: string): Promise<boolean> {
  try {
    const session = await cachedAuth();
    if (!session?.user) return false;
    if (assertGivingSession(session).kind !== "ok") return false;

    const resolved = await resolveOrgContext(session.user.id, slug);
    if (resolved.kind !== "ok") return false;

    const context = await loadGivingContext({
      personId: resolved.org.personId,
      organizationId: resolved.org.organizationId,
      organizationType: resolved.org.organizationType,
    });
    if (context.kind !== "ok") return false;
    // S4: a recorder (giving.record alone) reads no provider state at all, so
    // the badge - which reveals the connection's mode - is for view/manage only.
    if (!context.has.view && !context.has.manage) return false;

    const mode = await readOpenConnectionMode(resolved.org.personId, resolved.org.organizationId);
    return mode === "test";
  } catch {
    return false;
  }
}
