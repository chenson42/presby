import type { Metadata } from "next";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { isLocalLoginEnabled } from "@/lib/auth/local-login";
import { previewInvitation } from "@/lib/onboarding/accept";
import { INVITE_TOKEN_COOKIE } from "@/lib/onboarding/invite-cookie";
import { isWellFormedInvitationToken } from "@/lib/onboarding/invitation-token";
import { AnonymousState } from "./anonymous-state";
import { ConfirmState } from "./confirm-state";
import { DeadLinkState } from "./dead-link-state";
import { MismatchState } from "./mismatch-state";
import { TwoFactorState } from "./two-factor-state";
import { UnavailableState } from "./unavailable-state";

export const metadata: Metadata = {
  title: "Accept your invitation",
  robots: { index: false, follow: false },
};

// Never cached: the state depends on the token, the cookie and the session.
export const dynamic = "force-dynamic";

/**
 * `/invite?token=...` - the public, token-gated account-invitation page
 * (DECISION-183/185). A Server Component that renders exactly ONE state and
 * consumes nothing: mail scanners and link prefetchers open links, so GET only
 * previews (the existing verify-email page consumes on GET - not copied).
 *
 * The token comes from the query, else the `invite_token` hand-off cookie (R6:
 * the token never travels through `callbackUrl`, so after "Sign in to accept"
 * it is waiting here). The query always wins.
 *
 * `previewInvitation(token, session?.user?.id)`: the second argument is the
 * `auth()` session id and nothing else (D-3, source-scanned) - it makes the
 * database tell this page whether the signed-in account owns the invited
 * address, so the page never holds the full address. A null preview is the
 * ONE dead-link state, whatever the cause.
 *
 * Platform chrome only (no `BrandTokens`); no `layout.tsx`, no `loading.tsx`
 * in this group; imports no database module directly (S4).
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token: queryToken } = await searchParams;
  const jar = await cookies();
  const candidate =
    (typeof queryToken === "string" && queryToken) || jar.get(INVITE_TOKEN_COOKIE)?.value || "";
  // No token at all: possibly the render a server action's redirect prepared
  // without the path-scoped hand-off cookie; RecheckOnce re-asks the browser.
  if (candidate === "") return <DeadLinkState recheck />;
  if (!isWellFormedInvitationToken(candidate)) return <DeadLinkState />;
  const token = candidate;

  const session = await auth();
  let preview: Awaited<ReturnType<typeof previewInvitation>>;
  let localLoginEnabled: boolean;
  try {
    [preview, localLoginEnabled] = await Promise.all([
      previewInvitation(token, session?.user?.id),
      isLocalLoginEnabled(),
    ]);
  } catch {
    return <UnavailableState />;
  }
  if (!preview) return <DeadLinkState />;

  if (!session?.user?.id) {
    return <AnonymousState preview={preview} token={token} localLoginEnabled={localLoginEnabled} />;
  }
  if (preview.sessionMatches !== true) {
    return <MismatchState preview={preview} token={token} />;
  }
  if (session.user.twoFactorRequired && !session.user.twoFactorVerified) {
    return <TwoFactorState preview={preview} token={token} />;
  }
  return <ConfirmState preview={preview} token={token} />;
}
