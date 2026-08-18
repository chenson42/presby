import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  isEnterableOrganization,
  userOrganizations,
  type UserOrganization,
} from "@/lib/authz";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OrganizationsUnavailable } from "@/components/shared/organizations-unavailable";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Not connected to a congregation",
};

/**
 * `/no-organization` — the honest end of the funnel (G1).
 *
 * Before this page existed, a signed-in person with no congregation landed on
 * `/home` and read "you haven't been granted any roles yet" — which is about
 * platform FEATURES, not about churches, and which reads as a bug rather than
 * as a next step. This is the onboarding funnel, so it has to be specific about
 * WHY they are here and offer two real doors.
 *
 * The copy varies with what the unfiltered relationship list actually says,
 * which is the whole reason `presby_user_organizations` filters nothing:
 * "your only congregation is still being set up" and "you're not connected to a
 * congregation" are different sentences to the person reading them, and only
 * the unfiltered list can tell them apart.
 *
 * Naming the organization is safe HERE and only here — the user holds a
 * relationship with every organization named on this page. The access-denied
 * page at `/o/<slug>` is the one that must never vary by platform status.
 */
export default async function NoOrganizationPage() {
  const session = await cachedAuth();
  if (!session?.user) redirect("/signin?callbackUrl=/no-organization");

  let all: UserOrganization[];
  try {
    all = await userOrganizations(session.user.id);
  } catch {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <OrganizationsUnavailable retryHref="/no-organization" />
      </main>
    );
  }

  const enterable = all.filter(isEnterableOrganization);
  const pending = all.filter(
    (org) => org.endedOn === null && org.platformStatus === "invited",
  );
  const notTenants = all.filter(
    (org) => org.endedOn === null && org.platformStatus === "unmanaged",
  );
  const ended = all.filter((org) => org.endedOn !== null);

  // Arrived here by URL despite having somewhere to go. Say so and point at the
  // chooser rather than redirecting: an unexplained bounce reads as a glitch.
  if (enterable.length > 0) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <h1 className="text-2xl font-semibold">You already have access</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {enterable.length === 1
            ? "You have access to one organization."
            : `You have access to ${enterable.length} organizations.`}
        </p>
        <Button asChild className="mt-6 min-h-11">
          <Link href="/orgs">Choose where to go</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      {pending.length > 0 ? (
        <>
          <h1 className="text-2xl font-semibold">
            {pending.length === 1
              ? "Your organization is being set up"
              : "Your organizations are being set up"}
          </h1>
          <ul className="mt-3 space-y-1">
            {pending.map((org) => (
              <li key={org.organizationId} className="text-sm text-muted-foreground">
                {org.name} is being set up. We&apos;ll email you when it&apos;s
                ready.
              </li>
            ))}
          </ul>
        </>
      ) : notTenants.length > 0 ? (
        <>
          <h1 className="text-2xl font-semibold">
            Your congregation isn&apos;t on presby yet
          </h1>
          <ul className="mt-3 space-y-1">
            {notTenants.map((org) => (
              <li key={org.organizationId} className="text-sm text-muted-foreground">
                {org.name} is in our records through its presbytery, but
                isn&apos;t set up on presby yet.
              </li>
            ))}
          </ul>
        </>
      ) : ended.length > 0 ? (
        <>
          <h1 className="text-2xl font-semibold">Your access has ended</h1>
          <ul className="mt-3 space-y-1">
            {ended.map((org) => (
              <li key={org.organizationId} className="text-sm text-muted-foreground">
                Your access to {org.name} ended on{" "}
                {/*
                 * endedOn is a 'YYYY-MM-DD' calendar date, cast to text in SQL
                 * (src/lib/authz.ts) precisely so no driver invents a midnight
                 * for it. FormattedDate treats that shape as a calendar date
                 * and renders the same day in every timezone.
                 */}
                <FormattedDate value={org.endedOn!} mode="date" />.
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">
            You&apos;re not connected to a congregation yet
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re signed in, but no church, presbytery, or synod has added
            you to their records.
          </p>
        </>
      )}

      {/*
       * TWO DOORS, both static copy in P0.
       *
       * There is deliberately no "Request access" button: it needs a pending
       * request table and, harder, a notification target — and there is no
       * tenant permission catalog to answer "who at this congregation receives
       * this?" until P1 (DECISION-040). A button that silently goes nowhere is
       * worse than a sentence that tells you who to ask.
       */}
      <div className="mt-10 space-y-6 border-t border-border pt-8">
        <section>
          <h2 className="text-base font-semibold">
            Ask your church administrator
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            If your church already uses presby, someone there with administrator
            access can add you. They will need the email address you signed in
            with
            {session.user.email ? (
              <>
                :{" "}
                <span className="font-medium text-foreground">
                  {session.user.email}
                </span>
              </>
            ) : (
              "."
            )}
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">
            Is your church not on presby?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We are setting up congregations, presbyteries, and synods now.
          </p>
          <Button asChild variant="outline" className="mt-3 min-h-11">
            {/* Points at the backbone page until P2 builds the request form. */}
            <Link href="/">Read about presby</Link>
          </Button>
        </section>
      </div>

      <Link
        href="/home"
        className="mt-10 inline-block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        ← Back to home
      </Link>
    </main>
  );
}
