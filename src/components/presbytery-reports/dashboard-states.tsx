import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HELP_CONTACT_HREF } from "@/lib/help/urls";
import { DASHBOARD_COPY, FRAME_COPY, HUB_COPY } from "@/lib/presbytery-reports/copy";
import { ReportEmpty } from "./report-states";

/**
 * The dashboard's non-data answers (DECISION-342). Each is plain words and, where
 * a retry makes sense, one 44px link back to the page's own path (a Server
 * Component page needs no client state to retry). A card that fails or is locked
 * says so in its own box and never takes another card down.
 */

/** The viewer holds none of the four report keys: one state naming the four, never four locked cards. */
export function DashboardForbidden() {
  return (
    <div role="status" className="rounded-lg border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{DASHBOARD_COPY.forbidden.body}</p>
    </div>
  );
}

/** The hub read failed, so nothing is known about the viewer's keys: a load error, never forbidden. */
export function DashboardPageError({ retryHref }: { retryHref: string }) {
  return (
    <div role="alert" className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm text-muted-foreground">{DASHBOARD_COPY.pageError}</p>
      <Button asChild className="min-h-11 w-full sm:w-auto">
        <Link href={retryHref}>{FRAME_COPY.retry}</Link>
      </Button>
    </div>
  );
}

/** The roster count is zero: one empty state instead of four zero cards. */
export function DashboardEmpty() {
  return (
    <ReportEmpty
      title={DASHBOARD_COPY.empty.title}
      body={DASHBOARD_COPY.empty.body}
      action={{ href: HELP_CONTACT_HREF, label: DASHBOARD_COPY.empty.action }}
    />
  );
}

/** Card body when the card's own key is missing (the hub's wording, reused). */
export function CardLocked({ permissionPhrase }: { permissionPhrase: string }) {
  return (
    <div className="space-y-2">
      <Badge variant="outline">{HUB_COPY.lockedBadge}</Badge>
      <p className="break-words text-sm text-muted-foreground">{HUB_COPY.lockedReason(permissionPhrase)}</p>
    </div>
  );
}

/** Card body when its read failed: one message and a way to try again; the other cards render. */
export function CardError({ retryHref, message = DASHBOARD_COPY.cardError }: { retryHref: string; message?: string }) {
  return (
    <div role="alert" className="space-y-3">
      <p className="break-words text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
        <Link href={retryHref}>{FRAME_COPY.retry}</Link>
      </Button>
    </div>
  );
}
