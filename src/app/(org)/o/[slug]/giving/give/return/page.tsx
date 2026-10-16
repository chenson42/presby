import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, resolveOrgContext } from "@/lib/authz";
import { GiveReturnPanel } from "@/components/giving/give-return-panel";
import { readReturnState, type ReturnState } from "@/lib/giving/public-config";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";

/**
 * `/o/<slug>/giving/give/return?session_id=cs_...` - where Stripe sends a signed-in
 * member back. The same five panels as the public return page, read the same way
 * (presby's own rows by session id; the query string never marks anything paid),
 * behind the `(org)` auth pattern: sign-in -> the four-way org miss ->
 * `assertOrgAccess`. It does NOT re-check the Giving toggle: turning the toggle
 * off must not strand a donor who is mid-gift (ingest never depends on the
 * toggle either). `noindex`, `no-referrer`, `force-dynamic`, no `loading.tsx`.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your gift",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MemberGiveReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const { session_id: sessionId } = await searchParams;
  const path = `/o/${slug}/giving/give/return`;

  const session = await cachedAuth();
  if (!session?.user) {
    // Keep the deep link (with its session id) so signing back in lands on the
    // same panel; `/signin` sanitizes the callback to a same-origin path.
    redirect(`/signin?callbackUrl=${encodeURIComponent(typeof sessionId === "string" ? `${path}?session_id=${encodeURIComponent(sessionId)}` : path)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return <OrgAccessDenied name={resolved.name} organizationType={resolved.organizationType} slug={slug} />;
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }
  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const state: ReturnState =
    typeof sessionId === "string" ? await readReturnState(slug, sessionId) : { state: "unknown" };

  return (
    <div className="max-w-xl">
      <GiveReturnPanel
        state={state}
        giveHref={`/o/${slug}/giving/give`}
        homeHref={`/o/${slug}`}
        homeLabel="Back to the portal"
        retryHref={typeof sessionId === "string" ? `${path}?session_id=${encodeURIComponent(sessionId)}` : undefined}
      />
    </div>
  );
}
