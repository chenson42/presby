import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { sanitizeCallbackUrl } from "@/lib/auth/safe-callback";
import { availableOrganizations } from "@/lib/authz";
import {
  readIsPlatformAdmin,
  sessionCanAccessAdmin,
} from "@/lib/platform-admin";
import { OrganizationsUnavailable } from "@/components/shared/organizations-unavailable";
import { computeDestination } from "./destination";

export const metadata: Metadata = {
  title: "Signing you in",
};

/**
 * `/launch` — the single post-authentication target (DECISION-034).
 *
 * IT HAS NO UI ON THE HAPPY PATH. It gathers three inputs, hands them to
 * `computeDestination()` — the nine-row matrix, pure and unit-tested next
 * door — and redirects. Everything routing-shaped lives in that function so
 * that the rules are readable in one file and testable without a browser.
 *
 * It is separate from `/home` (DECISION-124 — this used to be `/orgs`) on
 * purpose. A chooser that auto-forwards a
 * one-organization user also auto-forwards a zero-organization platform admin
 * into `/admin`, from where the Developer card the operator asked for becomes
 * permanently unreachable. Separating the decision from the surface is what
 * makes "the chooser is a convenience, never a gate" structurally true.
 *
 * Two rows of the matrix are absent here and belong elsewhere: an unverified
 * 2FA challenge fires at the Edge on the DESTINATION (`/admin`, `/o/*`), and a
 * deactivated account is bounced by `src/proxy.ts` before this page renders.
 */
type SearchParam = string | string[] | undefined;

function firstValue(param: SearchParam): string | null {
  if (Array.isArray(param)) return param[0] ?? null;
  return param ?? null;
}

export default async function LaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: SearchParam; callbackUrl?: SearchParam }>;
}) {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/launch");

  const sp = await searchParams;
  const raw = firstValue(sp.next) ?? firstValue(sp.callbackUrl);
  // sanitizeCallbackUrl is a pure string function and the whole of the
  // open-redirect defence: anything absolute or protocol-relative comes back as
  // "/launch", which computeDestination's loop guard then drops. Whether a
  // surviving /o/<slug> path is one this user can actually enter is a UX
  // question, answered in computeDestination; the security answer is the
  // independent resolve at /o/<slug> itself.
  const requestedPath = raw ? sanitizeCallbackUrl(raw) : null;

  // THE TRY WRAPS THE FETCH AND NOTHING ELSE.
  //
  // next/navigation's redirect() works by THROWING NEXT_REDIRECT. A try/catch
  // around it swallows every successful route and serves a blank page — the
  // single most likely way to ship a broken /launch. The catch below returns
  // JSX, so the redirect cannot be moved inside the try without a type error;
  // that is deliberate, and it is why this shape should not be "tidied".
  let enterableOrgs: Array<{ slug: string }>;
  let isPlatformAdmin: boolean;
  try {
    [enterableOrgs, isPlatformAdmin] = await Promise.all([
      availableOrganizations(session.user.id),
      readIsPlatformAdmin(session.user.id),
    ]);
  } catch {
    // Renders. Does NOT redirect. Falling through to a zero-card chooser or to
    // /home would tell the user their access was revoked, which is a worse lie
    // than an outage.
    return (
      <main className="mx-auto max-w-2xl px-6 py-24">
        <OrganizationsUnavailable retryHref="/launch" />
      </main>
    );
  }

  const destination = computeDestination({
    enterableOrgs,
    isPlatformAdmin,
    canAccessAdmin: sessionCanAccessAdmin(session.user),
    requestedPath,
  });

  redirect(destination.path);
}
