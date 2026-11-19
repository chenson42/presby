import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PAGE_STATE } from "@/lib/committees/copy";
import { AREA } from "@/lib/committees/ui-copy";

/** A presbytery member without `groups.manage` (C1). Not the org denial: this person is a member, so the page may say so. */
export function CommitteesForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{AREA}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{PAGE_STATE.forbidden(name)}</p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure of a page's reader (C1). `href` is the page's own static path. */
export function CommitteesLoadError({ href }: { href: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{AREA}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{PAGE_STATE.loadError}</p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={href}>{PAGE_STATE.tryAgain}</Link>
      </Button>
    </section>
  );
}

/** One section's reader failed: say so in place, offer "Try again", leave the rest standing (C1). */
export function SectionLoadError({ href }: { href: string }) {
  return (
    <div role="alert" className="space-y-3 rounded-md border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{PAGE_STATE.sectionError}</p>
      <Button asChild size="sm" className="min-h-11 w-full sm:w-auto">
        <Link href={href}>{PAGE_STATE.tryAgain}</Link>
      </Button>
    </div>
  );
}

/** A form page whose committee cannot be edited or added to: one sentence and the way back (C4, C5, C6). */
export function FormUnavailable({ title, message, backHref, backLabel }: { title: string; message: string; backHref: string; backLabel: string }) {
  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" className="min-h-11">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </section>
  );
}

/** The guided empty state shared by the list and the add form: what is missing, why, and the next action. */
export function GuidedEmpty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      <div className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
