import type { ReactNode } from "react";
import Link from "next/link";
import { FRAME_COPY, MAP_COPY } from "@/lib/presbytery-reports/copy";
import type { MapResult } from "@/lib/presbytery-reports/dashboard";

/**
 * The congregation map's section (DECISION-343, docs/work-log/
 * 2026-11-17-presbytery-dashboard-map.md). A SERVER Component: the caption, the
 * legend's words, the "Not on the map" list, the empty prompt and the read-error line
 * are all server-rendered, so they stay true when tiles fail in the browser. The
 * client map arrives as a `slot` the page builds, so `src/components/` never imports
 * from `src/app/`, and the slot exists only for a key holder whose presbytery has a pin.
 *
 * It is a SIBLING section of the viability list (never inside it: the list's own
 * link-count e2e must not see the attribution or the entry links), shown only when the
 * list itself loaded (its fallback copy promises "the list below"):
 *
 *   off / locked, or the list not ok  -> nothing at all (no mention of a map)
 *   error                             -> heading, the read-error line, a retry link;
 *                                        NEVER the empty prompt (a failure must not read
 *                                        as "no location")
 *   ok, no pin                        -> heading and the empty prompt; no map element
 *   ok, a pin and a slot              -> heading, intro, the map, the caption, and the
 *                                        "Not on the map" list when it is not empty
 *
 * A name is tenant-entered text: React text only. A link to Congregation Oversight
 * renders only where that page's own flag is on; with it off the viewer is told where
 * locations are entered and that it is off, with no instruction to use it.
 */

const LINK = "text-primary underline-offset-4 hover:underline";
const BLOCK_LINK = `inline-flex min-h-11 items-center ${LINK}`;

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="dashboard-map-heading" data-testid="dashboard-map" className="space-y-3">
      <h2 id="dashboard-map-heading" className="text-xl font-semibold">
        {MAP_COPY.title}
      </h2>
      {children}
    </section>
  );
}

export function DashboardMap({
  map,
  viabilityOk,
  org,
  slug,
  oversightOn,
  retryHref,
  slot,
}: {
  map: MapResult;
  viabilityOk: boolean;
  org: string;
  slug: string;
  oversightOn: boolean;
  retryHref: string;
  slot: ReactNode;
}) {
  if (map.kind === "off" || map.kind === "locked" || !viabilityOk) return null;

  if (map.kind === "error") {
    return (
      <Section>
        <div role="alert" className="space-y-1">
          <p className="text-sm text-muted-foreground">{MAP_COPY.readError}</p>
          <Link href={retryHref} className={BLOCK_LINK}>
            {FRAME_COPY.retry}
          </Link>
        </div>
      </Section>
    );
  }

  const { pins, unplaced, total } = map.data;

  if (pins.length === 0) {
    return (
      <Section>
        <div data-testid="dashboard-map-empty" className="space-y-1 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium">{MAP_COPY.empty.title}</p>
          {oversightOn ? (
            <>
              <p className="text-sm text-muted-foreground">{MAP_COPY.empty.entry}</p>
              <Link href={`/o/${slug}/admin/oversight`} className={BLOCK_LINK}>
                {MAP_COPY.empty.link}
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{MAP_COPY.oversightOff(org)}</p>
          )}
        </div>
      </Section>
    );
  }

  // A pin with no client map (no tile key) is not a state the page produces; show nothing rather than a caption for a map that is not there.
  if (slot === null || slot === undefined) return null;

  return (
    <Section>
      <p className="text-sm text-muted-foreground">{MAP_COPY.intro(org)}</p>
      {slot}
      <p data-testid="dashboard-map-caption" className="text-sm text-muted-foreground">
        {MAP_COPY.caption(pins.length, total)}
      </p>
      {unplaced.length > 0 ? (
        <div data-testid="dashboard-map-unplaced" className="space-y-2">
          <h3 className="text-base font-medium">{MAP_COPY.unplaced.heading}</h3>
          <p className="text-sm text-muted-foreground">{MAP_COPY.unplaced.intro}</p>
          <p className="text-sm text-muted-foreground">
            {oversightOn ? MAP_COPY.unplaced.entry : MAP_COPY.oversightOff(org)}
          </p>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {unplaced.map((c) => (
              <li key={c.id} className="min-w-0">
                {oversightOn ? (
                  <Link href={`/o/${slug}/admin/oversight/${c.id}`} className={`${BLOCK_LINK} break-words`}>
                    {c.name}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center break-words text-sm">{c.name}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
