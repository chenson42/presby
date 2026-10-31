import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeaturesHelpLink } from "@/components/help/features-help-link";

/**
 * The non-data answers `/o/<slug>/admin/giving` (and, from Batch 2, every
 * route beneath it) can give — docs/work-log/2026-10-15-online-giving.md,
 * Phase 3 "Component / Page Plan". The four-way org miss (denied / ended /
 * 404) is handled one level up by `org-states.tsx`, reused as-is. Four copy
 * blocks, deliberately not collapsed: "not for this kind of organization",
 * "turned off", "not for your account" and "broken" are different facts and a
 * reader must be able to tell them apart. None of them is a 404 — a 404 would
 * hide that Giving exists at all and strand a treasurer who typed the right
 * URL on the wrong day.
 *
 * Server components, no hooks. They render NO tenant data: every one of them
 * is reachable by a member who holds no giving key.
 */

const HEADING = "Giving";

/** The organization's type is outside the toggle's allow-list (a presbytery,
 * synod or GA). Plain and final: there is no toggle to offer. */
export function GivingNotApplicable({ name }: { name: string }) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Giving isn&apos;t available for {name}. It applies to congregations and
        new worshiping communities.
      </p>
    </section>
  );
}

/**
 * The org's Giving toggle is off. An honest "not turned on", never a denial.
 * The Features link renders only when the viewer can use it
 * (`canManageFeatures`, read in the same transaction as the toggle itself —
 * DECISION-162: no second page-level permission read).
 */
export function GivingToggleOff({
  name,
  slug,
  canManageFeatures,
}: {
  name: string;
  slug: string;
  canManageFeatures: boolean;
}) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Giving isn&apos;t turned on for {name}.
        {canManageFeatures
          ? " You can turn it on from Features."
          : " Ask an administrator who manages your organization's features to turn it on."}
      </p>
      <FeaturesHelpLink />
      {canManageFeatures && (
        <Button asChild className="mt-6 min-h-11">
          <Link href={`/o/${slug}/admin/features`}>Go to Features</Link>
        </Button>
      )}
    </section>
  );
}

/** Giving is on, but the viewer holds none of the three giving keys. */
export function GivingForbidden({ name }: { name: string }) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Giving administration isn&apos;t available to your account at {name}. If
        you think it should be, ask your treasurer or another administrator
        there.
      </p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure reading the gate. Never an empty or
 * "off" answer — a blip must not read to a treasurer as revoked access. */
export function GivingLoadError({ slug, href }: { slug: string; href?: string }) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{HEADING}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We can&apos;t load Giving right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={href ?? `/o/${slug}/admin/giving`}>Try again</Link>
      </Button>
    </section>
  );
}

/**
 * The viewer holds a giving key, but not the one THIS page needs (a recorder
 * opening Funds, a viewer opening Settings). Names the page and points back to
 * the overview, which shows what their account can do. No data.
 */
export function GivingSectionForbidden({
  name,
  section,
  slug,
}: {
  name: string;
  section: string;
  slug: string;
}) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{section}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {section} isn&apos;t available to your account at {name}. If you think it
        should be, ask your treasurer or another administrator there.
      </p>
      <Button asChild variant="outline" className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/giving`}>Back to Giving</Link>
      </Button>
    </section>
  );
}

/** A "Back to Giving" link for the top of every giving sub-page (ui-standards: plain link, not a Button). */
export function GivingBackLink({ slug, label = "Back to Giving" }: { slug: string; label?: string }) {
  return (
    <Link
      href={`/o/${slug}/admin/giving`}
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}
