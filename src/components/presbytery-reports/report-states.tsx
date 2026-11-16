import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FRAME_COPY } from "@/lib/presbytery-reports/copy";

/** A report's read failed: plain words and one way to try again, back to this page and query. */
export function ReportLoadError({ retryHref }: { retryHref: string }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{FRAME_COPY.loadError}</p>
      <Button asChild className="min-h-11 w-full sm:w-auto">
        <Link href={retryHref}>{FRAME_COPY.retry}</Link>
      </Button>
    </div>
  );
}

/** The shared empty state, with an optional action link at a 44px target. */
export function ReportEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { href: string; label: string };
}) {
  const button: ReactNode = action ? (
    <Button asChild className="min-h-11">
      <Link href={action.href}>{action.label}</Link>
    </Button>
  ) : undefined;
  return <EmptyState title={title} body={body} action={button} />;
}
