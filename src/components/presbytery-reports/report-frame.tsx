import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FRAME_COPY } from "@/lib/presbytery-reports/copy";

/**
 * The one layout all six reports share: back link, the `<h1>`, a subtitle,
 * the standing notes, the export control(s) and the help link. Presentation
 * only; every string comes from `copy.ts`.
 */
export function ReportFrame({
  slug,
  title,
  subtitle,
  notes = [],
  actions,
  nav,
  helpHref,
  helpLabel,
  children,
}: {
  slug: string;
  title: string;
  subtitle: ReactNode;
  notes?: readonly string[];
  /** The export control(s); omitted when there is nothing honest to export. */
  actions?: ReactNode;
  /** Previous/next navigation (the trend window or the billing year). */
  nav?: ReactNode;
  helpHref: string;
  helpLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <Link
        href={`/o/${slug}/admin/reports`}
        className="inline-flex min-h-11 items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {FRAME_COPY.back}
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {actions ? <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">{actions}</div> : null}
      </div>

      {nav}

      {notes.length > 0 ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      ) : null}

      {children}

      <p className="text-sm">
        <Link href={helpHref} className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
          {helpLabel}
        </Link>
      </p>
    </section>
  );
}
