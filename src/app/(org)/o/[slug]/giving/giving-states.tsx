import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MEMBER_GIVING } from "@/lib/giving/giving-copy";

/**
 * The non-data answers `/o/<slug>/giving` can give a member - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 "Component / Page Plan". "Not for this
 * kind of organization" and "turned off" are the admin pages' own two blocks,
 * reused as they are (`GivingNotApplicable`, `GivingToggleOff` with no Features
 * link: a plain member cannot use it). This file adds the one that is a member's
 * alone: the LOAD ERROR. It says the history could not be loaded and that
 * nothing was lost - never an empty list, which would read as missing money.
 * Server component, no data, no hooks.
 */
export function MyGivingLoadError({ slug }: { slug: string }) {
  return (
    <section className="max-w-2xl" data-testid="giving-load-error">
      <h1 className="text-2xl font-semibold">{MEMBER_GIVING.heading}</h1>
      <p className="mt-3 text-base font-medium">{MEMBER_GIVING.loadError}</p>
      <p className="mt-1 text-sm text-muted-foreground">{MEMBER_GIVING.loadErrorBody}</p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/giving`}>{MEMBER_GIVING.tryAgain}</Link>
      </Button>
    </section>
  );
}

export { GivingNotApplicable, GivingToggleOff } from "../admin/giving/giving-admin-states";
