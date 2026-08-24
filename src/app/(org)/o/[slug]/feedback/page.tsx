import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, resolveOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { CongregationFeedbackForm } from "./feedback-form";

/**
 * `/o/<slug>/feedback` — the baseline-member on-ramp (Flow 0). Any current
 * member may reach this page and submit — NO `tickets.file` check, unlike
 * everything under `/o/<slug>/tickets*`. `submitFeedback()` itself carries
 * no permission gate either (`src/lib/tickets.ts`'s own header); this page's
 * `assertOrgAccess()` call is the entire gate, same as every other `(org)`
 * page's authoritative membership re-check.
 *
 * Shares `org_portal.tickets` with the tickets surface (Phase 3: "there is
 * no product reason to ship the on-ramp without the destination or vice
 * versa") — no separate flag.
 */
export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/feedback`)}`);
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const ticketsEnabled = await isFlagEnabled("org_portal.tickets");

  return (
    <section className="max-w-xl space-y-6">
      <Link
        href={`/o/${slug}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Back to portal
      </Link>

      {!ticketsEnabled ? (
        <div>
          <h1 className="text-2xl font-semibold">Feedback</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Sharing feedback isn&apos;t turned on for {resolved.org.name} yet.
          </p>
        </div>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-semibold">Feedback</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tell us about your experience at {resolved.org.name}. A
              designated role-holder reviews everything shared here.
            </p>
          </div>
          <CongregationFeedbackForm slug={slug} />
        </>
      )}
    </section>
  );
}
