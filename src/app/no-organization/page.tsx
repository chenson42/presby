import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { db } from "@/lib/db";
import { userTotp } from "@/lib/db/schema";
import {
  isEnterableOrganization,
  userOrganizations,
  type UserOrganization,
} from "@/lib/authz";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OrganizationsUnavailable } from "@/components/shared/organizations-unavailable";
import { Button } from "@/components/ui/button";
import { listInvitationsForAccount, type InPlaceInvitation } from "@/lib/onboarding/in-place";
import { NO_ORG_COPY } from "@/lib/onboarding/no-organization-copy";
import { CheckAgainForm } from "./check-again-form";
import { InvitationCards } from "./invitation-cards";
import { SwitchAccountForm } from "./switch-account-form";
import { deriveNoOrganizationView } from "./view";

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
 * COMMUNITY INCREMENT 2b: the page is composed by `deriveNoOrganizationView`
 * (view.ts), a pure function the unit tests drive over every combination. The
 * open invitations addressed to this proven account are listed and accepted in
 * place; "Check again" asks the connect definer once more; an account that has
 * nothing connected and nothing waiting reads N0. The listing failing (N5)
 * is a line above whichever block renders and never replaces the page: a
 * failure is "we don't know", never "there is nothing".
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
          <Link href="/home">Choose where to go</Link>
        </Button>
      </main>
    );
  }

  // The open invitations addressed to this proven account. A failure is N5: the
  // page still renders, with a line above it, and the view treats the listing as
  // unknown rather than empty.
  let invitations: InPlaceInvitation[] = [];
  let invitationsFailed = false;
  try {
    invitations = await listInvitationsForAccount(session.user.id);
  } catch {
    invitationsFailed = true;
  }

  // Is the account enrolled in two-factor sign-in? Picks which of the two
  // second-factor notices (verify or set up) applies. A failed read falls back to
  // "not enrolled": that notice leads to /account/2fa, which shows the
  // management view to someone already enrolled.
  let enrolled = false;
  try {
    const row = await db.query.userTotp.findFirst({
      where: eq(userTotp.userId, session.user.id),
      columns: { userId: true },
    });
    enrolled = row !== undefined;
  } catch {
    enrolled = false;
  }

  const view = deriveNoOrganizationView({
    enterable: enterable.length,
    pending: pending.length,
    notTenants: notTenants.length,
    ended: ended.length,
    invitations,
    invitationsFailed,
    session: {
      twoFactorRequired: session.user.twoFactorRequired === true,
      twoFactorVerified: session.user.twoFactorVerified === true,
    },
    enrolled,
  });

  const address = session.user.email ?? null;

  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      {(view.kind === "standing" || view.kind === "default") && view.listFailed && (
        <p
          role="alert"
          data-testid="listing-failed"
          className="mb-6 rounded-md border border-destructive p-3 text-sm"
        >
          {NO_ORG_COPY.listingFailed}
        </p>
      )}

      {view.kind === "standing" && view.block === "pending" ? (
        <>
          <h1 className="text-2xl font-semibold">
            {pending.length === 1
              ? "Your organization is being set up"
              : "Your organizations are being set up"}
          </h1>
          <ul className="mt-3 space-y-1">
            {pending.map((org) => (
              <li key={org.organizationId} className="break-words text-sm text-muted-foreground">
                {org.name} is being set up. We&apos;ll email you when it&apos;s
                ready.
              </li>
            ))}
          </ul>
        </>
      ) : view.kind === "standing" && view.block === "not_tenants" ? (
        <>
          <h1 className="text-2xl font-semibold">
            Your congregation isn&apos;t on PresbyPortal yet
          </h1>
          <ul className="mt-3 space-y-1">
            {notTenants.map((org) => (
              <li key={org.organizationId} className="break-words text-sm text-muted-foreground">
                {org.name} is in our records through its presbytery, but
                isn&apos;t set up on PresbyPortal yet.
              </li>
            ))}
          </ul>
        </>
      ) : view.kind === "standing" ? (
        <>
          <h1 className="text-2xl font-semibold">Your access has ended</h1>
          <ul className="mt-3 space-y-1">
            {ended.map((org) => (
              <li key={org.organizationId} className="break-words text-sm text-muted-foreground">
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
      ) : view.kind === "default" ? (
        <>
          <h1 className="text-2xl font-semibold">{NO_ORG_COPY.heading}</h1>
          <p className="mt-3 break-words text-sm text-muted-foreground">
            {address ? NO_ORG_COPY.body(address) : NO_ORG_COPY.bodyNoAddress}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{NO_ORG_COPY.secondLine}</p>
        </>
      ) : null}

      {/* Open invitations render below a standing block, or as the page itself. */}
      {view.kind === "standing" && view.cards.length > 0 && (
        <div className="mt-8">
          <InvitationCards cards={view.cards} enrolled={view.enrolled} />
        </div>
      )}
      {view.kind === "invited" && (
        <>
          <InvitationCards cards={view.cards} enrolled={view.enrolled} headingLevel={1} />
          <div className="mt-6">
            <SwitchAccountForm />
          </div>
        </>
      )}

      {/*
       * The "ask" door is the default view's alone: with an invitation open the
       * answer is on the page, and with a standing block above it the person has
       * a specific next step. There is deliberately no "Request access" button:
       * it needs a pending-request table and a notification target (DECISION-040),
       * and a button that silently goes nowhere is worse than a sentence that
       * tells you who to ask.
       */}
      <div className="mt-10 space-y-6 border-t border-border pt-8">
        {view.kind === "default" && (
          <section aria-labelledby="ask-heading">
            <h2 id="ask-heading" className="text-base font-semibold">
              {NO_ORG_COPY.officeHeading}
            </h2>
            {address && (
              <p className="mt-1 break-words text-sm text-muted-foreground">
                {NO_ORG_COPY.officeBody(address)}
              </p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{NO_ORG_COPY.invitationLine}</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
              <CheckAgainForm enrolled={view.enrolled} />
              <SwitchAccountForm />
            </div>
          </section>
        )}
        <section>
          <h2 className="text-base font-semibold">
            Is your church not on PresbyPortal?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We are setting up congregations, presbyteries, and synods now.
          </p>
          <Button asChild variant="outline" className="mt-3 min-h-11">
            {/* Points at the backbone page until P2 builds the request form. */}
            <Link href="/">Read about PresbyPortal</Link>
          </Button>
        </section>
      </div>
      <Link
        href="/home"
        className="mt-10 inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        ← Back to home
      </Link>
    </main>
  );
}
