"use client";

/**
 * The thin client loader (DECISION-343): the ONLY file that references `./map`, by
 * `next/dynamic` with `ssr: false` (a test pins that, and that nothing imports the map
 * statically). A same-height skeleton holds the place while the chunk loads, so the page
 * does not shift. The error boundary matters: a chunk that fails to load, or a Leaflet
 * exception, would otherwise reach `[slug]/error.tsx` and replace the WHOLE page,
 * taking the viability list with it. Here it becomes one honest line instead.
 */
import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { MAP_COPY } from "@/lib/presbytery-reports/copy";
import type { ClientPin } from "@/lib/presbytery-reports/map-derive";

function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="rounded-lg border border-border">
      <div className="flex h-72 items-center justify-center bg-secondary text-sm text-muted-foreground">{MAP_COPY.loading}</div>
      <div className="h-28 border-t border-border" />
    </div>
  );
}

const ViabilityMap = dynamic(() => import("./map"), { ssr: false, loading: () => <Skeleton /> });

function Failed() {
  return (
    <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
      {MAP_COPY.tilesError}
    </p>
  );
}

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Failed /> : this.props.children;
  }
}

export function ViabilityMapLoader({ tileUrl, pins }: { tileUrl: string; pins: ClientPin[] }) {
  return (
    <MapBoundary>
      <ViabilityMap tileUrl={tileUrl} pins={pins} />
    </MapBoundary>
  );
}
