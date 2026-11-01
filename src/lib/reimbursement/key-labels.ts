import { COPY } from "./copy";

/**
 * The short labels (`COPY.team.keyLabels`) for `keys`, in the labels' own order,
 * with a key that has no label dropped (never shown raw). Pure.
 */
export function keyLabelsFor(keys: readonly string[]): string[] {
  const present = new Set(keys);
  return Object.entries(COPY.team.keyLabels)
    .filter(([key]) => present.has(key))
    .map(([, label]) => label);
}
