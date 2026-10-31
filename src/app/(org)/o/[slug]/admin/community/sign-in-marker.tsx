import Link from "next/link";
import { Clock, Link2Off, MailWarning, TimerOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { DatedText } from "@/components/shared/dated-text";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SIGN_IN_MARKER_NO_EMAIL, signInMarkerLabel } from "@/lib/onboarding/sign-in-copy";
import type { SignInMarker as Marker } from "@/lib/onboarding/sign-in-types";

const ICON: Record<Marker["kind"], LucideIcon> = {
  pending: Clock,
  expired: TimerOff,
  bounced: MailWarning,
  blocked: TriangleAlert,
  not_connected: Link2Off,
};

const AMBER =
  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
const NEUTRAL = "border-border text-foreground";

/**
 * The sign-in marker on a Community list row and on a Session roster row
 * (Phase 3 and amendments 2 and 3, Copy group E): an icon AND a word, never
 * colour alone, linking to the person's card (`#sign-in` on the edit page, where
 * Send again lives). Presentational and client-safe; the pure `getSignInMarkers`
 * decides whether there is a marker at all, and only for a `people.manage`
 * viewer, so this renders nothing when handed none.
 *
 * It is a SIBLING of a row's own link, never inside one (a link in a link is
 * invalid HTML), and the person's name is appended in screen-reader-only text
 * (the Edit button's precedent), so each marker's accessible name says whose it
 * is without a second visible string. The whole link is a 44px target; the pill
 * inside wraps, so a long label never runs off a 360px screen. Words come from
 * `sign-in-copy.ts`; the date is a `<FormattedDate>`.
 */
export function SignInMarker({
  marker,
  slug,
  personId,
  personName,
}: {
  marker: Marker | undefined;
  slug: string;
  personId: string;
  personName: string;
}) {
  if (!marker) return null;
  const Icon = ICON[marker.kind];
  const tone = marker.kind === "not_connected" ? NEUTRAL : AMBER;
  const dates = marker.kind === "pending" ? [marker.sentAt] : [];
  return (
    <Link
      href={`/o/${slug}/admin/community/${personId}/edit#sign-in`}
      data-testid="sign-in-marker"
      data-marker={marker.kind}
      className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* A Badge whose label may wrap: the stock one is one line and clips. */}
      <Badge
        variant="outline"
        className={cn("h-auto max-w-full items-start justify-start gap-1 overflow-visible rounded-2xl whitespace-normal text-left", tone)}
      >
        <Icon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        <span className="break-words">
          <DatedText dates={dates} render={(...d) => signInMarkerLabel(marker, () => d[0] ?? "")} />
          {marker.kind === "not_connected" && marker.noEmail ? `. ${SIGN_IN_MARKER_NO_EMAIL}` : null}
          {/* Inside the text span, so the space is not collapsed as a flex child's would be. */}
          <span className="sr-only">{` ${personName}`}</span>
        </span>
      </Badge>
    </Link>
  );
}
