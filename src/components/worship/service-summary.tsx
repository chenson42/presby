import { Ban, CalendarDays, MapPin } from "lucide-react";
import { SERVICES_COPY } from "@/lib/worship/copy";
import { formatWhen } from "./service-when";

/** The service's when and where, with the Cancelled badge as text plus an icon. */
export function ServiceSummary({
  startsAt,
  location,
  cancelled,
}: {
  startsAt: string;
  location: string | null;
  cancelled: boolean;
}) {
  return (
    <div className="space-y-1 text-base">
      <p className="flex items-start gap-2 [overflow-wrap:anywhere]">
        <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{formatWhen(startsAt)}</span>
      </p>
      {location ? (
        <p className="flex items-start gap-2 text-muted-foreground [overflow-wrap:anywhere]">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{location}</span>
        </p>
      ) : null}
      {cancelled ? (
        <p className="flex items-center gap-2 font-medium" data-testid="service-cancelled">
          <Ban className="size-4 shrink-0" aria-hidden />
          <span>{SERVICES_COPY.page.cancelledBadge}</span>
        </p>
      ) : null}
    </div>
  );
}
