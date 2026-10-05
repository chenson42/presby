"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false on the server and during the hydration render; true on the render
 * after hydration, and from the very first render of any client-only mount
 * (a client-side navigation, a dialog opening). DECISION-159.
 *
 * Deliberately NOT `useEffect(() => setHydrated(true), [])`: that renders
 * `false` first on EVERY mount, so a client-side navigation to a gated form
 * would flash disabled for a frame.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
